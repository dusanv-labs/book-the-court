import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Post,
  type RawBodyRequest,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import Stripe from 'stripe';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { Booking } from '../generated/prisma/client.js';
import { isOverlapViolation, PrismaService } from '../prisma/prisma.service.js';

/** Stripe needs at least 30 minutes; one more so the limit is never hit because of clock or network delays. */
export const CHECKOUT_MINUTES = 31;
/** The court is held a little longer than the payment page lives, so a payment made at the last second still finds it. */
export const HOLD_MINUTES = 35;

/** What the app needs to know about a Stripe Checkout Session. */
export interface CheckoutState {
  sessionId: string;
  bookingId: string | null;
  status: 'open' | 'complete' | 'expired';
  paid: boolean;
  paymentIntentId: string | null;
}

export interface CheckoutRequest {
  bookingId: string;
  code: string;
  description: string;
  /** Whole currency units (the app stores prices in whole dinars). */
  amount: number;
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/** The payment provider, behind an interface so tests can use a fake one (CI never calls Stripe). */
export interface PaymentGateway {
  createCheckout(request: CheckoutRequest): Promise<{ sessionId: string; url: string }>;
  getCheckout(sessionId: string): Promise<CheckoutState>;
  /** Stops an open payment page from accepting a payment. */
  expireCheckout(sessionId: string): Promise<void>;
  /** Full refund. The idempotency key makes a retried refund safe (Stripe refunds only once). */
  refund(paymentIntentId: string, idempotencyKey: string): Promise<void>;
}

type PaidFields = { paymentStatus: 'PAID'; paymentIntentId: string; paidAt: Date };

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export function checkoutState(session: Stripe.Checkout.Session): CheckoutState {
  const intent = session.payment_intent;
  return {
    sessionId: session.id,
    bookingId: session.client_reference_id,
    status: session.status === 'complete' ? 'complete' : session.status === 'expired' ? 'expired' : 'open',
    paid: session.payment_status === 'paid',
    paymentIntentId: typeof intent === 'string' ? intent : (intent?.id ?? null),
  };
}

/** Checks the Stripe-Signature header against the raw request body and returns the event. Throws if it does not match. */
export function verifyWebhook(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

export function createStripeGateway(secretKey: string): PaymentGateway {
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return {
    async createCheckout(r) {
      const metadata = { bookingId: r.bookingId, code: r.code };
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: r.bookingId,
          customer_email: r.customerEmail,
          line_items: [
            {
              quantity: 1,
              // Stripe expects the amount in the smallest unit (para), prices here are whole dinars.
              price_data: { currency: r.currency.toLowerCase(), unit_amount: r.amount * 100, product_data: { name: r.description } },
            },
          ],
          // Cards only: a card payment is finished when the customer leaves the payment page.
          allowed_payment_method_types: ['card'],
          submit_type: 'book',
          expires_at: Math.floor(r.expiresAt.getTime() / 1000),
          success_url: r.successUrl,
          cancel_url: r.cancelUrl,
          metadata,
          payment_intent_data: { metadata, description: r.description },
        },
        // A retried request returns the same session instead of creating a second one.
        { idempotencyKey: `checkout-${r.bookingId}` },
      );
      if (!session.url) throw new Error('Stripe did not return a payment page URL');
      return { sessionId: session.id, url: session.url };
    },
    async getCheckout(sessionId) {
      return checkoutState(await stripe.checkout.sessions.retrieve(sessionId));
    },
    async expireCheckout(sessionId) {
      await stripe.checkout.sessions.expire(sessionId);
    },
    async refund(paymentIntentId, idempotencyKey) {
      await stripe.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey });
    },
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
  ) {}

  get enabled(): boolean {
    return this.gateway !== null;
  }

  /** Releases courts held for payments that were never finished. */
  releaseExpiredHolds(now = new Date()) {
    return this.prisma.booking.updateMany({
      where: { status: 'PENDING', holdExpiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
  }

  /** Opens a Stripe payment page for a booking that holds its court. If Stripe fails, the court is released. */
  async startCheckout(booking: Booking, description: string, currency: string): Promise<string> {
    const gateway = this.requireGateway();
    const manage = `${this.config.WEB_URL}#/manage/${booking.cancelToken}`;
    try {
      const { sessionId, url } = await gateway.createCheckout({
        bookingId: booking.id,
        code: booking.code,
        description,
        amount: booking.price,
        currency,
        customerEmail: booking.customerEmail,
        successUrl: `${manage}?payment=done`,
        cancelUrl: `${manage}?payment=cancelled`,
        expiresAt: new Date(Date.now() + CHECKOUT_MINUTES * 60_000),
      });
      await this.prisma.booking.update({ where: { id: booking.id }, data: { checkoutSessionId: sessionId, checkoutUrl: url } });
      return url;
    } catch (e) {
      this.logger.error(`Could not start the payment for booking ${booking.code}: ${(e as Error).message}`);
      await this.prisma.booking.updateMany({ where: { id: booking.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      throw new ServiceUnavailableException('Online payment is not available right now. Please try again or pay at the venue.');
    }
  }

  /** Asks Stripe about a booking still waiting for payment (used when the player comes back from the payment page). */
  async refresh(booking: Booking): Promise<void> {
    if (!this.gateway || booking.paymentStatus !== 'UNPAID' || !booking.checkoutSessionId) return;
    try {
      await this.apply(await this.gateway.getCheckout(booking.checkoutSessionId));
    } catch (e) {
      // The webhook will still update the booking; the page just shows "waiting for payment" a bit longer.
      this.logger.warn(`Could not check the payment for booking ${booking.code}: ${(e as Error).message}`);
    }
  }

  /**
   * Applies the state of a payment page to its booking. Called from the webhook and from refresh(),
   * possibly at the same time and more than once, so every change is conditional on the current state.
   */
  async apply(state: CheckoutState): Promise<void> {
    if (!state.bookingId) return;
    const booking = await this.prisma.booking.findUnique({ where: { id: state.bookingId } });
    // Ignore events for other sessions or bookings (for example deleted by the nightly demo reset).
    if (!booking || booking.checkoutSessionId !== state.sessionId || booking.paymentStatus !== 'UNPAID') return;

    if (state.status === 'expired') {
      await this.prisma.booking.updateMany({ where: { id: booking.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      return;
    }
    if (state.status !== 'complete' || !state.paid || !state.paymentIntentId) return;

    const paid: PaidFields = { paymentStatus: 'PAID', paymentIntentId: state.paymentIntentId, paidAt: new Date() };
    if (booking.status === 'CANCELLED') {
      // Cancelled while the payment page was still open: the money goes straight back.
      await this.refundAndCancel(booking.id, booking.code, state.paymentIntentId, paid);
      return;
    }
    try {
      const { count } = await this.prisma.booking.updateMany({
        where: { id: booking.id, paymentStatus: 'UNPAID', status: { in: ['PENDING', 'EXPIRED'] } },
        data: { ...paid, status: 'CONFIRMED', holdExpiresAt: null },
      });
      if (count > 0) this.logger.log(`Booking ${booking.code} paid online and confirmed.`);
    } catch (e) {
      if (!isOverlapViolation(e)) throw e;
      // The hold ran out and somebody else booked the time before the payment arrived: refund it.
      await this.refundAndCancel(booking.id, booking.code, state.paymentIntentId, paid);
    }
  }

  /** Full refund of a booking paid online (before it is cancelled). */
  async refundPaid(booking: Booking): Promise<void> {
    if (!booking.paymentIntentId) throw new Error(`Booking ${booking.code} is paid but has no payment reference`);
    await this.refund(booking.paymentIntentId, booking.id, booking.code);
  }

  /**
   * Closes the payment page of a booking that was just cancelled before it was paid. If the player
   * paid in that same moment, apply() sees the cancelled booking and refunds the payment.
   */
  async closeCheckout(booking: Booking): Promise<void> {
    if (!this.gateway || !booking.checkoutSessionId) return;
    try {
      await this.gateway.expireCheckout(booking.checkoutSessionId);
    } catch {
      // Already completed or expired: refresh() handles a completed one.
      await this.refresh({ ...booking, status: 'CANCELLED' });
    }
  }

  private async refundAndCancel(id: string, code: string, paymentIntentId: string, paid: PaidFields) {
    await this.refund(paymentIntentId, id, code);
    const now = new Date();
    await this.prisma.booking.update({
      where: { id },
      data: { ...paid, status: 'CANCELLED', cancelledAt: now, paymentStatus: 'REFUNDED', refundedAt: now, holdExpiresAt: null },
    });
    this.logger.warn(`Booking ${code} was paid after its court was released; the payment was refunded.`);
  }

  private async refund(paymentIntentId: string, bookingId: string, code: string) {
    const gateway = this.requireGateway();
    try {
      await gateway.refund(paymentIntentId, `refund-${bookingId}`);
    } catch (e) {
      this.logger.error(`Refund for booking ${code} failed: ${(e as Error).message}`);
      throw new BadGatewayException('The payment could not be refunded right now. Please try again in a few minutes.');
    }
  }

  private requireGateway(): PaymentGateway {
    if (!this.gateway) throw new ServiceUnavailableException('Online payment is not available.');
    return this.gateway;
  }
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Stripe calls this when a payment page is completed or expires. */
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  @ApiExcludeEndpoint()
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    const secret = this.config.STRIPE_WEBHOOK_SECRET;
    if (!secret || !this.payments.enabled) throw new NotFoundException();
    let event: Stripe.Event;
    try {
      event = verifyWebhook(req.rawBody ?? '', signature ?? '', secret);
    } catch {
      throw new BadRequestException('Invalid signature.');
    }
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.expired':
        await this.payments.apply(checkoutState(event.data.object));
        break;
    }
    return { received: true };
  }
}

@Module({
  controllers: [PaymentsController],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.STRIPE_SECRET_KEY ? createStripeGateway(config.STRIPE_SECRET_KEY) : null),
    },
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}

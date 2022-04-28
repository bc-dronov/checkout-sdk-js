import { some } from 'lodash';

import { Address } from '../../../address';
import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import { MissingDataError, MissingDataErrorType, RequestError } from '../../../common/error/errors';
import { OrderActionCreator, OrderPaymentRequestBody, OrderRequestBody } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import { PaymentArgumentInvalidError, PaymentMethodFailedError } from '../../errors';
import { isHostedInstrumentLike, PaymentMethod } from '../../index';
import isVaultedInstrument from '../../is-vaulted-instrument';
import { CreditCardInstrument, NonceInstrument, PaymentInstrument, PaymentInstrumentMeta } from '../../payment';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import { PaymentInitializeOptions, PaymentRequestOptions } from '../../payment-request-options';
import PaymentStrategy from '../payment-strategy';

import BraintreePaymentProcessor from './braintree-payment-processor';

export default class BraintreeCreditCardPaymentStrategy implements PaymentStrategy {
    private _is3dsEnabled?: boolean;
    private _isHostedFormInitialized?: boolean;
    private _deviceSessionId?: string;
    private _paymentMethod?: PaymentMethod;

    constructor(
        private _store: CheckoutStore,
        private _orderActionCreator: OrderActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _braintreePaymentProcessor: BraintreePaymentProcessor
    ) {}

    async initialize(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        const state = await this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(options.methodId));
        this._paymentMethod = state.paymentMethods.getPaymentMethod(options.methodId);

        if (!this._paymentMethod?.clientToken) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        try {
            this._braintreePaymentProcessor.initialize(this._paymentMethod.clientToken, options.braintree);

            if (this._isHostedPaymentFormEnabled(options.methodId, options.gatewayId) && options.braintree?.form) {
                await this._braintreePaymentProcessor.initializeHostedForm(options.braintree.form);
                this._isHostedFormInitialized = this._braintreePaymentProcessor.isInitializedHostedForm();
            }

            this._is3dsEnabled = this._paymentMethod.config.is3dsEnabled;
            this._deviceSessionId = await this._braintreePaymentProcessor.getSessionId();
        } catch (error) {
            this._handleError(error);
        }

        return this._store.getState();
    }

    async execute(orderRequest: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        const { payment, ...order } = orderRequest;

        if (!payment) {
            throw new PaymentArgumentInvalidError(['payment']);
        }

        const state = await this._store.dispatch(
            this._orderActionCreator.submitOrder(order, options)
        );

        const {
            billingAddress: { getBillingAddressOrThrow },
            order: { getOrderOrThrow },
            payment: { isPaymentDataRequired },
        } = state;

        if (!isPaymentDataRequired(order.useStoreCredit)) {
            return state;
        }

        const billingAddress = getBillingAddressOrThrow();
        const orderAmount = getOrderOrThrow().orderAmount;

        try {
            return await this._store.dispatch(this._paymentActionCreator.submitPayment({
                ...payment,
                paymentData: this._isHostedFormInitialized
                    ? await this._prepareHostedPaymentData(payment, billingAddress, orderAmount)
                    : await this._preparePaymentData(payment, billingAddress, orderAmount),
            }));
        } catch (error) {
            if (this._is3DSFixExperimentOn()) {
                return this._processAdditionalAction(error, payment, orderAmount);
            }

            this._handleError(error);
        }
    }

    finalize(): Promise<InternalCheckoutSelectors> {
        return Promise.reject(new OrderFinalizationNotRequiredError());
    }

    async deinitialize(): Promise<InternalCheckoutSelectors> {
        this._isHostedFormInitialized = false;

        await Promise.all([
            this._braintreePaymentProcessor.deinitialize(),
            this._braintreePaymentProcessor.deinitializeHostedForm(),
        ]);

        return this._store.getState();
    }

    private _handleError(error: Error): never {
        if (error.name === 'BraintreeError') {
            throw new PaymentMethodFailedError(error.message);
        }

        throw error;
    }

    private async _preparePaymentData(payment: OrderPaymentRequestBody, billingAddress: Address, orderAmount: number): Promise<PaymentInstrument & PaymentInstrumentMeta> {
        const { paymentData } = payment;
        const commonPaymentData = { deviceSessionId: this._deviceSessionId };

        if (this._isSubmittingWithStoredCard(payment) || this._isStoringNewCard(payment)) {
            return {
                ...commonPaymentData,
                ...paymentData,
            };
        }

        const {
            shouldSaveInstrument = false,
            shouldSetAsDefaultInstrument = false,
        } = isHostedInstrumentLike(paymentData) ? paymentData : {};

        const { nonce } = this._shouldPerform3DSVerification(payment)
            ? await this._braintreePaymentProcessor.verifyCard(payment, billingAddress, orderAmount)
            : await this._braintreePaymentProcessor.tokenizeCard(payment, billingAddress);

        return {
            ...commonPaymentData,
            nonce,
            shouldSaveInstrument,
            shouldSetAsDefaultInstrument,
        };
    }

    private async _prepareHostedPaymentData(payment: OrderPaymentRequestBody, billingAddress: Address, orderAmount: number): Promise<PaymentInstrument & PaymentInstrumentMeta> {
        const { paymentData } = payment;
        const commonPaymentData = { deviceSessionId: this._deviceSessionId };

        if (this._isSubmittingWithStoredCard(payment)) {
            const { nonce } = await this._braintreePaymentProcessor.tokenizeHostedFormForStoredCardVerification();

            return {
                ...commonPaymentData,
                ...paymentData,
                nonce,
            };
        }

        const {
            shouldSaveInstrument = false,
            shouldSetAsDefaultInstrument = false,
        } = isHostedInstrumentLike(paymentData) ? paymentData : {};

        if (this._shouldPerform3DSVerification(payment)) {
            const merchantAccountId = this._getMerchantAccountIdOrThrow();

            const { nonce } = this._is3DSFixExperimentOn()
                ? await this._braintreePaymentProcessor.verifyCardWithHostedFormAnd3DSCheck(billingAddress, orderAmount, merchantAccountId)
                : await this._braintreePaymentProcessor.verifyCardWithHostedForm(billingAddress, orderAmount);

            return {
                ...commonPaymentData,
                shouldSaveInstrument,
                shouldSetAsDefaultInstrument,
                nonce,
            };
        }

        const { nonce } = await this._braintreePaymentProcessor.tokenizeHostedForm(billingAddress);

        return {
            ...commonPaymentData,
            shouldSaveInstrument,
            shouldSetAsDefaultInstrument,
            nonce,
        };
    }

    private async _processAdditionalAction(
        error: Error,
        payment: OrderPaymentRequestBody,
        orderAmount: number
    ): Promise<InternalCheckoutSelectors> {
        if (!(error instanceof RequestError) || !some(error.body.errors, { code: 'three_d_secure_required' })) {
            return this._handleError(error);
        }

        try {
            const { payer_auth_request: storedCreditCardNonce } = error.body.three_ds_result || {};
            const { nonce } = await this._braintreePaymentProcessor.challenge3DSVerification(storedCreditCardNonce, orderAmount);

            return await this._store.dispatch(this._paymentActionCreator.submitPayment({
                ...payment,
                paymentData: {
                    deviceSessionId: this._deviceSessionId,
                    nonce,
                },
            }));
        } catch (error) {
            return this._handleError(error);
        }
    }

    private _isHostedPaymentFormEnabled(methodId?: string, gatewayId?: string): boolean {
        if (!methodId) {
            return false;
        }

        const { paymentMethods: { getPaymentMethodOrThrow } } = this._store.getState();
        const paymentMethod = getPaymentMethodOrThrow(methodId, gatewayId);

        return paymentMethod.config.isHostedFormEnabled === true;
    }

    private _isSubmittingWithStoredCard(payment: OrderPaymentRequestBody): boolean {
        return !!(payment.paymentData && isVaultedInstrument(payment.paymentData));
    }

    private _isStoringNewCard(payment: OrderPaymentRequestBody): boolean {
        return !!(payment.paymentData && (payment.paymentData as CreditCardInstrument | NonceInstrument)?.shouldSaveInstrument);
    }

    private _shouldPerform3DSVerification(payment: OrderPaymentRequestBody): boolean {
        return !!(this._is3dsEnabled && !this._isSubmittingWithStoredCard(payment));
    }

    private _getMerchantAccountIdOrThrow(): string {
        const merchantAccountId = this._paymentMethod?.initializationData.merchantAccountId;

        if (!merchantAccountId) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        return merchantAccountId;
    }

    private _is3DSFixExperimentOn(): boolean {
        const state = this._store.getState();
        const storeConfig = state.config.getStoreConfigOrThrow();

        return storeConfig.checkoutSettings.features['PAYPAL-1177.braintree-3ds-issue'];
    }
}

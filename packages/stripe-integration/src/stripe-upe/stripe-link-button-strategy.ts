import {
    Address,
    // BillingAddressRequestBody,
    CheckoutButtonStrategy, createCurrencyService, CurrencyService,
    CustomerInitializeOptions,
    // FormattedHostedInstrument,
    // FormattedHostedInstrument,
    InvalidArgumentError, isRequestError,
    MissingDataError,
    MissingDataErrorType, NotInitializedError, NotInitializedErrorType, PaymentIntegrationSelectors,
    PaymentIntegrationService, PaymentMethodCancelledError, PaymentMethodFailedError,
    RequestError, ShippingOption,
    // StripeUPEIntent,
} from '@bigcommerce/checkout-sdk/payment-integration-api';
import StripeUPEScriptLoader from './stripe-upe-script-loader';
import {
    AddressOptions,
    StripeConfirmPaymentData,
    StripeElements,
    StripeElementsCreateOptions,
    StripeElementType, StripeError,
    StripeStringConstants,
    StripeUPEClient,
    StripeUPEPaymentIntentStatus
} from './stripe-upe';
// import { isStripeUPEPaymentMethodLike } from './is-stripe-upe-payment-method-like';
import { WithStripeUPECustomerInitializeOptions } from '@bigcommerce/checkout-sdk/stripe-integration';
import {Payment} from '@bigcommerce/checkout-sdk/core';
import {includes, round, some} from 'lodash';
import { isStripeUPEPaymentMethodLike } from './is-stripe-upe-payment-method-like';

export default class StripeLinkButtonStrategy implements CheckoutButtonStrategy {
    private _stripeUPEClient?: StripeUPEClient;
    private _stripeElements?: StripeElements;
    private _currencyService?: CurrencyService;

    constructor(
        private paymentIntegrationService: PaymentIntegrationService,
        private scriptLoader: StripeUPEScriptLoader,
    ) {}

    async initialize(options: CustomerInitializeOptions & WithStripeUPECustomerInitializeOptions,): Promise<void> {
        if (!options.stripeupe) {
            throw new InvalidArgumentError(
                `Unable to proceed because "options" argument is not provided.`,
            );
        }

        const { container, isLoading } = options.stripeupe;
        const gatewayId ='stripeupe';
        const methodId= 'card';

        Object.entries(options.stripeupe).forEach(([key, value]) => {
            if (!value) {
                throw new InvalidArgumentError(
                    `Unable to proceed because "${key}" argument is not provided.`,
                );
            }
        });

        await this.paymentIntegrationService.loadPaymentMethod(gatewayId, {
            params: { method: methodId },
        });

        const state = this.paymentIntegrationService.getState();
        const paymentMethod = state.getPaymentMethodOrThrow(methodId, gatewayId);
        const { clientToken, returnUrl } = paymentMethod;
        // await this.paymentIntegrationService.loadPaymentMethod(gatewayId, {
        //     params: { method: methodId },
        // });

        // const state = this.paymentIntegrationService.getState();
        // const paymentMethod = state.getPaymentMethodOrThrow(methodId, gatewayId);
        // const { clientToken } = paymentMethod;

        if (!isStripeUPEPaymentMethodLike(paymentMethod) || !clientToken) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentToken);
        }

        const {
            initializationData: { stripePublishableKey },
        } = paymentMethod;
        console.log('Stripe Link INIT2');
        this._stripeUPEClient = await this.scriptLoader.getStripeClient(stripePublishableKey);

        const expressCheckoutOptions: StripeElementsCreateOptions = {
            paymentMethods: {
                link: 'auto',
                applePay: 'never',
                googlePay: 'never',
                amazonPay: 'never',
                paypal: 'never',
            },
        }

        const { cartAmount: amount } = this.paymentIntegrationService.getState().getCartOrThrow();
        const elementsOptions = {
            mode: 'payment',
            amount: amount * 100,
            currency: 'usd',
        };

        this._stripeElements = await this.scriptLoader.getElements(this._stripeUPEClient, elementsOptions);

        const expressCheckoutElement = this._stripeElements.create(StripeElementType.EXPRESS_CHECKOUT, expressCheckoutOptions);
        expressCheckoutElement.mount('#' + container);

        if (isLoading) {
            isLoading(false);
        }

        expressCheckoutElement.on('confirm', async (event) => {
            if (!this._stripeUPEClient || !this._stripeElements) {
                throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
            }

            // await this.paymentIntegrationService.loadPaymentMethod(gatewayId, {
            //     params: { method: methodId },
            // });
            //
            // const state = this.paymentIntegrationService.getState();
            // const paymentMethod = state.getPaymentMethodOrThrow(methodId, gatewayId);
            // const { clientToken, returnUrl } = paymentMethod;

            const { paymentIntent, error: stripeError } = await this._stripeUPEClient.confirmPayment({
                elements: this._stripeElements,
                clientSecret: clientToken,
                redirect: StripeStringConstants.IF_REQUIRED,
                confirmParams: {
                    return_url: returnUrl,
                },
            });

            console.log('confirm', event);
            console.log('paymentIntent', paymentIntent);
            console.log('stripeError', stripeError);

            if (!paymentIntent) {
                throw new RequestError();
            }

            const { address: shippingAddress} = event.shippingAddress;
            const { address: billingDetails, name, phone, email } = event.billingDetails;
            const firstName = name.split(' ')[0];
            const lastName = name.split(' ')[1];
            console.log(firstName, lastName, shippingAddress, billingDetails, phone, email, returnUrl);

            await this.paymentIntegrationService.updateBillingAddress({
                firstName,
                lastName,
                phone,
                company: '',
                address1: 'Str. 2',
                address2: 'Street 1',
                city: 'Miami',
                countryCode: billingDetails.country || '',
                postalCode: billingDetails.postal_code || '',
                stateOrProvince: 'California',
                stateOrProvinceCode: '',
                email,
                customFields: [],
            });

            await this.paymentIntegrationService.updateShippingAddress({
                firstName,
                lastName,
                phone,
                company: '',
                address1: 'Str. 2',
                address2: 'Street 1',
                city: 'Miami',
                countryCode: shippingAddress?.country || '',
                postalCode: shippingAddress?.postal_code || '',
                stateOrProvince: 'California',
                stateOrProvinceCode: '',
                customFields: [],
            });

            // await this.paymentIntegrationService.updateShippingAddress({
            //     firstName,
            //     lastName,
            //     phone,
            //     company: '',
            //     address1: shippingAddress?.line1 || '',
            //     address2: '',
            //     city: shippingAddress?.city || '',
            //     countryCode: shippingAddress?.country || '',
            //     postalCode: shippingAddress?.postal_code || '',
            //     stateOrProvince: shippingAddress?.state || '',
            //     stateOrProvinceCode: '',
            //     customFields: [],
            // });

            // await this.paymentIntegrationService.updateBillingAddress({
            //     firstName,
            //     lastName,
            //     phone,
            //     email,
            //     company: '',
            //     address1: billingDetails.line1 || '',
            //     address2: '',
            //     city: billingDetails.city || '',
            //     countryCode: billingDetails.country || '',
            //     postalCode: billingDetails.postal_code || '',
            //     stateOrProvince: '',
            //     stateOrProvinceCode: '',
            //     customFields: [],
            // });

            console.log('paymentIntent', paymentIntent);

            const paymentPayload = this._getPaymentPayload(
                methodId,
                paymentIntent.id,
            );

            console.log('submit order');
            await this.paymentIntegrationService.submitOrder({}, { params: { methodId } });
            console.log('submit order end');

            // try {
            //     console.log('submitPayment');
            await this.paymentIntegrationService.submitPayment(paymentPayload);
            console.log('_processAdditionalAction', this._processAdditionalAction);
            // } catch (error) {
            //     console.log('catch submitPayment');
            //     this._processAdditionalAction(error, methodId);
            // }
        });

        const countries = await this.paymentIntegrationService.loadShippingCountries();
        const allowedShippingCountries = countries
            .getShippingCountries()
            ?.map((country) => country.code);

        console.log('allowedShippingCountries', allowedShippingCountries);

        expressCheckoutElement.on('click', async (event) => {
            console.log('click', event);

            event.resolve({
                allowedShippingCountries,
                shippingAddressRequired: true,
                shippingRates: [
                    {  id: 'mock', amount: 40, displayName: 'Mock should not be displayed' },
                ],
                billingAddressRequired: true,
                emailRequired: true,
                phoneNumberRequired: true,
            });
        });

        expressCheckoutElement.on('shippingaddresschange', async (event: any) => {
            const shippingAddress = event.address;
            const result = {
                firstName: '',
                lastName: '',
                phone: '',
                company: '',
                address1: shippingAddress?.line1 || '',
                address2: shippingAddress?.line2 || '',
                city: shippingAddress?.city || '',
                countryCode: shippingAddress?.country || '',
                postalCode: shippingAddress?.postal_code || '',
                stateOrProvince: shippingAddress?.state || '',
                stateOrProvinceCode: '',
                customFields: [],
            };

            await this.paymentIntegrationService.updateShippingAddress(result);

            const shippingRates = await this.getAvailableShippingOptions();
            const totalPrice = this.getTotalPrice();

            if (this._stripeElements) {
                this._stripeElements.update({
                    currency: 'usd',
                    mode: 'payment',
                    amount: Math.round(+totalPrice * 100),
                });
            }

            event.resolve({
                shippingRates,
            });
        });

        expressCheckoutElement.on('shippingratechange', async (event) => {
            console.log('shippingratechange', event);

            // await this.paymentIntegrationService.loadPaymentMethod(gatewayId, {
            //     params: { method: methodId },
            // });
            //
            // const state = this.paymentIntegrationService.getState();
            // const paymentMethod = state.getPaymentMethodOrThrow(methodId, gatewayId);
            // const { clientToken } = paymentMethod;

            if (this._stripeElements) {
                this._stripeElements.update({
                    // clientSecret: clientToken,
                    currency: 'usd',
                    mode: 'payment',
                    amount: amount * 100,

                });
                // this._stripeElements.update({
                //     clientSecret: clientToken
                // });
                // await this._stripeElements.fetchUpdates();
            }

            event.resolve({});
        });

        return Promise.resolve();
    }

    getTotalPrice(): string {
        const { getCheckoutOrThrow, getCartOrThrow } = this.paymentIntegrationService.getState();
        const { decimalPlaces } = getCartOrThrow().currency;
        const totalPrice = round(getCheckoutOrThrow().outstandingBalance, decimalPlaces).toFixed(
            decimalPlaces,
        );

        return totalPrice;
    }

    async getAvailableShippingOptions() {
        const state = this.paymentIntegrationService.getState();
        const storeConfig = state.getStoreConfigOrThrow();
        const consignments = state.getConsignments();

        if (!this._currencyService) {
            this._currencyService = createCurrencyService(storeConfig);
        }

        console.log('consignments', consignments);
        if (!consignments?.[0]) {
            // Info: we can not return an empty data because shippingOptions should contain at least one element, it caused a developer exception
            return;
        }

        const consignment = consignments[0];

        const availableShippingOptions = (consignment.availableShippingOptions || []).map(
            this._getStripeShippingOption.bind(this),
        );
        console.log('availableShippingOptions', availableShippingOptions);

        if (availableShippingOptions.length) {
            if (!consignment.selectedShippingOption?.id && availableShippingOptions[0]) {
                await this.handleShippingOptionChange(availableShippingOptions[0].id);
            }
        }

        return availableShippingOptions;
    };

    async handleShippingOptionChange(optionId: string) {
        if (optionId === 'shipping_option_unselected') {
            return;
        }

        return this.paymentIntegrationService.selectShippingOption(optionId);
    }

    private _getStripeShippingOption({ id, cost, description }: ShippingOption) {
        return {
            id,
            displayName: description,
            amount: cost * 100,
        };
    }

    deinitialize(): Promise<void> {
        return Promise.resolve();
    }

    private _getPaymentPayload(
        methodId: string,
        token: string,
    ): Payment {
        const cartId = this.paymentIntegrationService.getState().getCart()?.id || '';
        const formattedPayload: any = {
            cart_id: cartId,
            credit_card_token: { token },
            confirm: true,
            vault_payment_instrument: false,
            set_as_default_stored_instrument: false,
        };

        return {
            methodId,
            paymentData: {
                formattedPayload,
            },
        };
    }

    private async _processAdditionalAction(
        error: Error,
        methodId: string,
    ): Promise<PaymentIntegrationSelectors | never> {
        console.log('_processAdditionalAction 1');
        if (!isRequestError(error)) {
            throw error;
        }

        if (!this._stripeUPEClient || !this._stripeElements) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }
        console.log('_processAdditionalAction 2');

        if (some(error.body.errors, { code: 'additional_action_required' })) {
            console.log('22');
            const {
                type,
                data: { token, redirect_url },
            } = error.body.additional_action_required;
            const isPaymentCompleted = await this._isPaymentCompleted(methodId);
            console.log('3');

            if (type === 'redirect_to_url' && redirect_url && !isPaymentCompleted) {
                console.log('33');
                const { paymentIntent, error: stripeError } =
                    await this._stripeUPEClient.confirmPayment(
                        this._mapStripePaymentData(redirect_url),
                    );

                if (stripeError) {
                    console.log('333');
                    this._throwDisplayableStripeError(stripeError);
                    throw new PaymentMethodFailedError();
                }

                if (!paymentIntent) {
                    console.log('3333');
                    throw new RequestError();
                }
            } else if (type === 'additional_action_requires_payment_method' && token) {
                console.log('4');
                let result;
                let catchedConfirmError = false;
                const stripePaymentData = this._mapStripePaymentData();
                const isPaymentCompleted = await this._isPaymentCompleted(methodId);

                try {
                    console.log('44');
                    result = !isPaymentCompleted
                        ? await this._stripeUPEClient.confirmPayment(stripePaymentData)
                        : await this._stripeUPEClient.retrievePaymentIntent(token);
                } catch (error) {
                    console.log('444');
                    try {
                        result = await this._stripeUPEClient.retrievePaymentIntent(token);
                    } catch (error) {
                        catchedConfirmError = true;
                    }
                }
                console.log('5');
                if (result?.error) {
                    console.log('55');
                    this._throwDisplayableStripeError(result.error);

                    if (this._isCancellationError(result.error)) {
                        throw new PaymentMethodCancelledError();
                    }

                    throw new PaymentMethodFailedError();
                }

                if (!result?.paymentIntent && !catchedConfirmError) {
                    console.log('6');
                    throw new RequestError();
                }

                const paymentPayload = this._getPaymentPayload(
                    methodId,
                    catchedConfirmError ? token : result?.paymentIntent?.id,
                );

                console.log('7');

                try {
                    console.log('77');
                    return await this.paymentIntegrationService.submitPayment(paymentPayload);
                } catch (error) {
                    // INFO: for case if payment was successfully confirmed on Stripe side but on BC side something go wrong, request failed and order status hasn't changed yet
                    // For shopper we need to show additional message that BC is waiting for stripe confirmation, to prevent additional payment creation
                    throw new PaymentMethodFailedError(
                        "We've received your order and are processing your payment. Once the payment is verified, your order will be completed. We will send you an email when it's completed. Please note, this process may take a few minutes depending on the processing times of your chosen method.",
                    );
                }
            }
        }

        console.log('_processAdditionalAction end');
        throw error;
    }

    private _isCancellationError(stripeError: StripeError | undefined) {
        return (
            stripeError &&
            stripeError.payment_intent.last_payment_error?.message?.indexOf('canceled') !== -1
        );
    }

    private _throwDisplayableStripeError(stripeError: StripeError) {
        if (
            includes(['card_error', 'invalid_request_error', 'validation_error'], stripeError.type)
        ) {
            throw new Error(stripeError.message);
        }
    }

    private _mapStripePaymentData(returnUrl?: string): StripeConfirmPaymentData {
        const billingAddress = this.paymentIntegrationService.getState().getBillingAddress();
        const address = this._mapStripeAddress(billingAddress);

        const { firstName, lastName, email } = billingAddress || {};

        if (!this._stripeElements) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        if (!email || !address || !address.city || !address.country || !firstName || !lastName) {
            throw new MissingDataError(MissingDataErrorType.MissingBillingAddress);
        }

        return {
            elements: this._stripeElements,
            redirect: StripeStringConstants.IF_REQUIRED,
            confirmParams: {
                payment_method_data: {
                    billing_details: {
                        email,
                        address,
                        name: `${firstName} ${lastName}`,
                    },
                },
                ...(returnUrl && { return_url: returnUrl }),
            },
        };
    }

    private _mapStripeAddress(address?: Address): AddressOptions {
        if (address) {
            const { city, address1, address2, countryCode: country, postalCode } = address;

            return {
                city,
                country,
                postal_code: postalCode,
                line1: address1,
                line2: address2,
            };
        }

        throw new MissingDataError(MissingDataErrorType.MissingBillingAddress);
    }

    private async _isPaymentCompleted(methodId: string) {
        const state = this.paymentIntegrationService.getState();
        const paymentMethod = state.getPaymentMethodOrThrow(methodId);
        const { features } = state.getStoreConfigOrThrow().checkoutSettings;

        if (
            !paymentMethod.clientToken ||
            !this._stripeUPEClient ||
            !features['PI-626.Block_unnecessary_payment_confirmation_for_StripeUPE']
        ) {
            return false;
        }

        const retrivedPI = await this._stripeUPEClient.retrievePaymentIntent(
            paymentMethod.clientToken,
        );

        return retrivedPI.paymentIntent?.status === StripeUPEPaymentIntentStatus.SUCCEEDED;
    }

}

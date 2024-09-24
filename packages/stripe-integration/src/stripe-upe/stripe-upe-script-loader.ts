import { ScriptLoader } from '@bigcommerce/script-loader';

import { PaymentMethodClientUnavailableError } from '@bigcommerce/checkout-sdk/payment-integration-api';

import {
    StripeElements,
    StripeElementsOptions,
    StripeHostWindow,
    StripeUPEClient,
} from './stripe-upe';

export default class StripeUPEScriptLoader {
    constructor(
        private scriptLoader: ScriptLoader,
        private stripeWindow: StripeHostWindow = window,
    ) {}

    async getStripeClient(
        stripePublishableKey?: string,
        stripeAccount?: string,
        locale?: string,
    ): Promise<StripeUPEClient> {
        let stripeClient = this.stripeWindow.bcStripeClient;
        console.log('stripeAccount', stripeAccount);
        console.log('locale', locale);
        console.log('stripePublishableKey', stripePublishableKey);

        if (!stripeClient) {
            const stripe = await this.load();

            stripeClient = stripe('pk_test_iyRKkVUt0YWpJ3Lq7mfsw3VW008KiFDH4s');

            Object.assign(this.stripeWindow, { bcStripeClient: stripeClient });
        }

        return stripeClient;
    }

    async getElements(
        stripeClient: StripeUPEClient,
        options: StripeElementsOptions,
    ): Promise<StripeElements> {
        let stripeElements = this.stripeWindow.bcStripeElements;

        if (!stripeElements) {
            stripeElements = stripeClient.elements(options);

            Object.assign(this.stripeWindow, { bcStripeElements: stripeElements });
        } else {
            stripeElements.update(options);
            await stripeElements.fetchUpdates();
        }

        return stripeElements;
    }

    private async load() {
        if (!this.stripeWindow.Stripe) {
            await this.scriptLoader.loadScript('https://js.stripe.com/v3/');

            if (!this.stripeWindow.Stripe) {
                throw new PaymentMethodClientUnavailableError();
            }
        }

        return this.stripeWindow.Stripe;
    }
}

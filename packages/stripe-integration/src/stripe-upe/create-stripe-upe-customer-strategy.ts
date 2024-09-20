import { getScriptLoader } from '@bigcommerce/script-loader';

import {
    CheckoutButtonStrategyFactory,
    toResolvableModule,
} from '@bigcommerce/checkout-sdk/payment-integration-api';

// import StripeUPECustomerStrategy from './stripe-upe-customer-strategy';
import StripeUPEScriptLoader from './stripe-upe-script-loader';
import StripeLinkButtonStrategy from './stripe-link-button-strategy';

const createStripeUPECustomerStrategy: CheckoutButtonStrategyFactory<StripeLinkButtonStrategy> = (
    paymentIntegrationService,
) => {
    return new StripeLinkButtonStrategy(
        paymentIntegrationService,
        new StripeUPEScriptLoader(getScriptLoader()),
    );
};

export default toResolvableModule(createStripeUPECustomerStrategy, [{ id: 'stripeupe' }]);

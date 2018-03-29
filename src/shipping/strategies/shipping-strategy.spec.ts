import { DataStore } from '@bigcommerce/data-store';
import { InternalAddress } from '../../address';
import { createCheckoutClient, createCheckoutStore, CheckoutSelectors } from '../../checkout';
import ShippingStrategy from './shipping-strategy';

describe('ShippingStrategy', () => {
    let store: DataStore<CheckoutSelectors>;

    class FoobarShippingStrategy extends ShippingStrategy {
        updateAddress(address: InternalAddress, options?: any): Promise<CheckoutSelectors> {
            return Promise.resolve(store.getState());
        }

        selectOption(addressId: string, optionId: string, options?: any): Promise<CheckoutSelectors> {
            return Promise.resolve(store.getState());
        }
    }

    beforeEach(() => {
        store = createCheckoutStore();
    });

    it('returns checkout state after initialization', async () => {
        const strategy = new FoobarShippingStrategy(store);
        const state = await strategy.initialize();

        expect(state).toEqual(store.getState());
    });

    it('returns checkout state after deinitialization', async () => {
        const strategy = new FoobarShippingStrategy(store);
        const state = await strategy.deinitialize();

        expect(state).toEqual(store.getState());
    });
});

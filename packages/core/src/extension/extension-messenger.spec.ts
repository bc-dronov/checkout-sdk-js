import { createCheckoutStore, ReadableCheckoutStore } from '../checkout';
import { getCheckoutStoreState } from '../checkout/checkouts.mock';
import { IframeEventListener, IframeEventPoster } from '../common/iframe';

import { ExtensionNotFoundError } from './errors';
import { UnsupportedExtensionCommandError } from './errors/unsupported-extension-command-error';
import { Extension } from './extension';
import { ExtensionCommandHandler } from './extension-command-handler';
import { ExtensionMessenger } from './extension-messenger';
import {
    ExtensionCommand,
    ExtensionOriginEvent,
    ExtensionOriginEventMap,
} from './extension-origin-event';
import { getExtensionMessageEvent, getExtensions } from './extension.mock';

describe('ExtensionMessenger', () => {
    let extension: Extension;
    let extensionCommandHandler: ExtensionCommandHandler;
    let extensionMessenger: ExtensionMessenger;
    let event: {
        origin: string;
        data: ExtensionOriginEvent;
    };
    let store: ReadableCheckoutStore;

    beforeEach(() => {
        store = createCheckoutStore(getCheckoutStoreState());
        extension = getExtensions()[0];
        event = getExtensionMessageEvent();

        extensionCommandHandler = jest.fn();
    });

    describe('#listen() and #stopListen()', () => {
        let listener: IframeEventListener<ExtensionOriginEventMap>;

        beforeEach(() => {
            listener = new IframeEventListener(extension.url);

            const listeners = {
                [extension.id]: listener,
            };

            extensionMessenger = new ExtensionMessenger(store, listeners, {});
        });

        it('should throw if unable to find the extensiion', () => {
            expect(() =>
                extensionMessenger.listen(
                    'xxx',
                    ExtensionCommand.ReloadCheckout,
                    extensionCommandHandler,
                ),
            ).toThrow(ExtensionNotFoundError);
        });

        it('should throw if trying to listen for an unsupported command', () => {
            expect(() =>
                extensionMessenger.listen(
                    extension.id,
                    'INVALID_COMMAND' as ExtensionCommand,
                    extensionCommandHandler,
                ),
            ).toThrow(UnsupportedExtensionCommandError);
        });

        it('should listen and add an event listener', () => {
            jest.spyOn(listener, 'listen');
            jest.spyOn(listener, 'addListener');

            extensionMessenger.listen(
                extension.id,
                ExtensionCommand.ReloadCheckout,
                extensionCommandHandler,
            );

            expect(listener.listen).toHaveBeenCalled();
            expect(listener.addListener).toHaveBeenCalledWith(
                ExtensionCommand.ReloadCheckout,
                extensionCommandHandler,
            );
        });

        it('should remove the event listener', () => {
            jest.spyOn(listener, 'removeListener');

            const remover = extensionMessenger.listen(
                extension.id,
                ExtensionCommand.ReloadCheckout,
                extensionCommandHandler,
            );

            remover();

            expect(listener.removeListener).toHaveBeenCalledWith(
                ExtensionCommand.ReloadCheckout,
                extensionCommandHandler,
            );
        });

        it('should stop listening', () => {
            jest.spyOn(listener, 'stopListen');

            extensionMessenger.listen(
                extension.id,
                ExtensionCommand.ReloadCheckout,
                extensionCommandHandler,
            );

            extensionMessenger.stopListen(extension.id);

            expect(listener.stopListen).toHaveBeenCalled();
        });
    });

    describe('#post()', () => {
        it('should throw ExtensionNotFoundError if the extension is not rendered yet', () => {
            const container = document.createElement('div');

            document.querySelector = jest.fn().mockReturnValue(container);

            extensionMessenger = new ExtensionMessenger(store, {}, {});

            expect(() => extensionMessenger.post(extension.id, event.data)).toThrow(
                ExtensionNotFoundError,
            );
        });

        it('should post to an extension', () => {
            const container = document.createElement('div');
            const iframe = document.createElement('iframe');

            container.appendChild(iframe);

            const poster = new IframeEventPoster(extension.url, window);
            const posters = {
                [extension.id]: poster,
            };

            extensionMessenger = new ExtensionMessenger(store, {}, posters);

            document.querySelector = jest.fn().mockReturnValue(container);

            jest.spyOn(iframe, 'contentWindow', 'get').mockReturnValue(window);
            jest.spyOn(poster, 'post');

            extensionMessenger.post(extension.id, event.data);

            expect(poster.post).toHaveBeenCalledWith(event.data);
        });
    });
});
import { Controller } from '@src/controller/Controller';
import { Media } from '@src/media/Media';
import { Module } from '@src/Module';
import { createAllSupported, createFirstSupported } from '@src/ModuleLoader';
import { Player } from '@src/player/Player';
import { PlayerError } from '@src/PlayerError';
import { selectMedia } from '@src/selectMedia';
import '@src/styles.scss';
import {
  Config,
  Env,
  ErrorCodes,
  ErrorEventData,
  EventCallback,
  EventData,
  Events,
  Format,
  IInstance,
  ModuleLoaderTypes,
} from '@src/types';
import { getEnv } from '@src/utils/getEnv';
import EventEmitter from 'eventemitter3';
import find from 'lodash/find';

export class Instance implements IInstance {
  /**
   * The initial player config.
   * @type {Config}
   */
  public config: Config;

  /**
   * The root container.
   * @type {HTMLElement}
   */
  public container: HTMLElement;

  /**
   * Container specifically for the video element.
   * @type {HTMLElement}
   */
  public playerContainer: HTMLElement;

  public adsContainer: HTMLElement;

  public uiContainer: HTMLElement;

  public env: Env;

  public controller: Controller;

  public player: Player;

  public media: Media;

  public format: Format;

  public extensions: Module[];

  /**
   * Allow the instance to emit and listen to events.
   * @type {EventEmitter}
   */
  private emitter: EventEmitter;

  constructor(element: HTMLElement, config: Config) {
    this.config = config;

    this.createContainers(element);

    this.emitter = new EventEmitter();

    this.init(config);
  }

  public on = (name: string, callback: EventCallback) =>
    this.emitter.on(name, callback);

  public once = (name: string, callback: EventCallback) =>
    this.emitter.once(name, callback);

  public removeListener = (name: string, callback: EventCallback) =>
    this.emitter.removeListener(name, callback);

  public emit = (name: string, eventData?: EventData) =>
    this.emitter.emit(name, eventData);

  public play() {
    this.controller.play();
  }

  public pause() {
    this.controller.pause();
  }

  public seekTo(time: number) {
    this.controller.seekTo(time);
  }

  public setVolume(volume: number) {
    this.controller.setVolume(volume);
  }

  public setError(error: PlayerError) {
    this.controller.unload();
    this.emit(Events.ERROR, {
      error,
    } as ErrorEventData);
  }

  public canAutoplay(): boolean {
    return this.config.autoplay && this.env.canAutoplay;
  }

  public destroy() {
    this.emit(Events.DESTROY);

    this.emitter.removeAllListeners();

    this.controller.unload();

    this.controller = null;
    this.player = null;
    this.format = null;
    this.media = null;

    const div: HTMLElement = this.container;
    while (div.firstChild) {
      div.removeChild(div.firstChild);
    }

    this.container.remove();
  }

  public getStats() {
    return {
      controller: [this.controller.name, this.controller],
      media: [this.media.name, this.media],
      player: [this.player.name, this.player],
      extensions: this.extensions.map(extension => [extension.name, extension]),
    };
  }

  public getModule(name: string): Module {
    const modules = [
      ...this.extensions,
      this.controller,
      this.media,
      this.player,
    ];

    return find(modules, { name });
  }

  private createContainers(element: HTMLElement) {
    this.container = document.createElement('div');
    this.container.classList.add('ig-container');

    this.playerContainer = document.createElement('div');
    this.playerContainer.classList.add('ig-player');
    this.container.appendChild(this.playerContainer);

    this.adsContainer = document.createElement('div');
    this.adsContainer.classList.add('ig-ads');
    this.container.appendChild(this.adsContainer);

    this.uiContainer = document.createElement('div');
    this.uiContainer.classList.add('ig-ui');
    this.container.appendChild(this.uiContainer);

    element.appendChild(this.container);
  }

  private async init(config: Config) {
    if (!config.ignorePolyfills) {
      await import(/* webpackChunkName: 'polyfills' */ 'ts-polyfill');
    }

    this.env = await getEnv();

    this.controller = await createFirstSupported<Controller>(
      ModuleLoaderTypes.CONTROLLER,
      this,
      this.config,
    );
    await this.controller.boot();

    this.extensions = await createAllSupported<Module>(
      ModuleLoaderTypes.EXTENSION,
      this,
      this.config,
    );

    this.player = await createFirstSupported<Player>(
      ModuleLoaderTypes.PLAYER,
      this,
    );

    const [format, media] = await selectMedia(this, config.sources);

    if (!media) {
      this.setError(new PlayerError(ErrorCodes.NO_SUPPORTED_FORMAT_FOUND));
      return;
    }

    this.format = format;
    this.media = media;

    try {
      await this.controller.load();
    } catch (error) {
      this.setError(new PlayerError(ErrorCodes.CONTROLLER_LOAD_FAILED, error));
      return;
    }

    this.emit(Events.READY);

    // Now that we know we can autoplay, actually do it.
    if (this.canAutoplay()) {
      this.play();
    }
  }
}

/**
 * Entry point for the on-device backend.
 *
 * Exposes a single `window.AppDB` object that assets/js/app.js calls instead of
 * fetching api.php. Action names, request shapes and response bodies are
 * identical to the PHP API, so the front-end JavaScript is unchanged.
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { call } from './api';
import { db, integrityCheck, pragmas, ValidationError } from './db';
import { APP_NAME, APP_VERSION } from './config';
import { invalidateSettings } from './helpers';

export type AppDB = {
  call: (action: string, body: Record<string, any>, query: Record<string, string>) => Promise<any>;
  download: (action: string, query: Record<string, string>) => Promise<string>;
  ready: () => Promise<{
    app: string;
    version: string;
    path: string;
    integrity: string;
    pragmas: Record<string, any>;
  }>;
};

const api: AppDB = {
  /** Runs one action and returns its JSON body, throwing Error on failure. */
  async call(action, body, query) {
    try {
      return await call(action, { body: body ?? {}, query: query ?? {} });
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new Error(err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message || 'The database could not complete that request.');
    }
  },

  /**
   * Builds a file (CSV or a JSON backup) and hands it to the Android share
   * sheet, so it can be saved to Drive, sent to a PC, and so on.
   */
  async download(action, query) {
    const result = await api.call(action, {}, query);

    if (!result || typeof result.content !== 'string') {
      throw new Error('Nothing to export yet.');
    }

    const filename = String(result.filename ?? 'export.csv');
    const written = await Filesystem.writeFile({
      path: filename,
      data: result.content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    try {
      await Share.share({
        title: filename,
        text: filename,
        url: written.uri,
        dialogTitle: filename,
      });
    } catch {
      // The user dismissed the share sheet — that is not an error.
    }

    return filename;
  },

  /** Opens the database and reports where it lives, for the Settings page. */
  async ready() {
    const conn = await db();
    const url = await conn.getUrl().catch(() => ({ url: '' }));
    const integrity = await integrityCheck().catch(() => 'unavailable');
    invalidateSettings();
    return {
      app: APP_NAME,
      version: APP_VERSION,
      path: url.url ?? 'store.sqlite',
      integrity,
      pragmas: pragmas(),
    };
  },
};

(window as any).AppDB = api;

export default api;
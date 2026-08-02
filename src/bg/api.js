import { api, apiAll } from '../lib/gitlab.js';
import { apiErrorEntry } from '../lib/log.js';
import { log } from './store.js';

export function tapi(settings, path) {
  return api(settings, path).catch((e) => {
    log(apiErrorEntry(e));
    throw e;
  });
}

export function tapiAll(settings, path, maxPages = 5) {
  return apiAll(settings, path, maxPages).catch((e) => {
    log(apiErrorEntry(e));
    throw e;
  });
}

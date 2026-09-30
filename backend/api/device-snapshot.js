import { createHandlers } from '../lib/handlers.js';
export default { fetch: request => createHandlers().snapshot(request) };

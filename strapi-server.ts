// Re-export so Strapi's plugin loader can resolve the server entry both from
// source (during development) and from the built dist output (when installed).
export { default } from './server/src';

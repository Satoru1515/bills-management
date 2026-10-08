/** Path of the service worker (public/sw.js); its scope is the whole site. */
export const SERVICE_WORKER_URL = "/sw.js";

type ServiceWorkerHost = { serviceWorker?: Pick<ServiceWorkerContainer, "register"> };

/**
 * Registers the service worker in production builds only: in `next dev` it
 * would serve cached scripts and get in the way of hot reload. Never throws;
 * the app works the same without it.
 */
export async function registerServiceWorker(
  host: ServiceWorkerHost | undefined = typeof navigator === "undefined" ? undefined : navigator,
  enabled = process.env.NODE_ENV === "production",
): Promise<ServiceWorkerRegistration | null> {
  if (!enabled || !host?.serviceWorker) return null;
  try {
    // updateViaCache "none": the browser always checks for a new sw.js.
    return await host.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
    return null;
  }
}

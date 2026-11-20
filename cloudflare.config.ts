export default {
  worker: {
    name: 'webxr-vision',
    compatibilityDate: '2026-11-20',
    assets: {
      notFoundHandling: 'single-page-application'
    },
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        invocationLogs: true
      }
    }
  }
};

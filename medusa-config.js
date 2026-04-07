const { loadEnv, defineConfig } = require('@medusajs/framework/utils')

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  admin: {
    disable: true,
  },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS,
      adminCors: process.env.ADMIN_CORS,
      authCors: process.env.AUTH_CORS,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@variablevic/mollie-payments-medusa/providers/mollie",
            id: "mollie",
            options: {
              apiKey: process.env.MOLLIE_API_KEY,
              redirectUrl: process.env.MOLLIE_REDIRECT_URL || "https://alterion-solar-warm.vercel.app/afrekenen",
              medusaUrl: process.env.MEDUSA_URL || "https://alterion-medusa-backend.onrender.com",
              autoCapture: true,
            },
          },
        ],
      },
    },
  ],
})

import { CreateInventoryLevelInput, ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { ApiKey } from "../../.medusa/types/query-entry-points";

const updateStoreCurrencies = createWorkflow(
  "update-store-currencies",
  (input: {
    supported_currencies: { currency_code: string; is_default?: boolean }[];
    store_id: string;
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => {
              return {
                currency_code: currency.currency_code,
                is_default: currency.is_default ?? false,
              };
            }
          ),
        },
      };
    });

    const stores = updateStoresStep(normalizedInput);

    return new WorkflowResponse(stores);
  }
);

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

  const countries = ["nl", "be", "de"];

  logger.info("Seeding Alterion store data...");
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [
          {
            name: "Default Sales Channel",
          },
        ],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [
        {
          currency_code: "eur",
          is_default: true,
        },
      ],
    },
  });

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });

  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Benelux",
          currency_code: "eur",
          countries,
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  const region = regionResult[0];
  logger.info("Finished seeding regions.");

  logger.info("Seeding tax regions...");
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({
      country_code,
      provider_id: "tp_system",
    })),
  });
  logger.info("Finished seeding tax regions.");

  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "Alterion Warehouse",
          address: {
            city: "Amstelveen",
            country_code: "NL",
            address_1: "Keurmeesterstraat 53",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_location_id: stockLocation.id,
      },
    },
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  logger.info("Seeding fulfillment data...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [
            {
              name: "Default Shipping Profile",
              type: "default",
            },
          ],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Alterion Delivery",
    type: "shipping",
    service_zones: [
      {
        name: "Benelux",
        geo_zones: countries.map((country_code) => ({
          country_code,
          type: "country" as const,
        })),
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standaard Bezorging",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Standaard",
          description: "Levering binnen 3-5 werkdagen.",
          code: "standard",
        },
        prices: [
          {
            currency_code: "eur",
            amount: 0,
          },
          {
            region_id: region.id,
            amount: 0,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
      {
        name: "Express Installatie",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Express",
          description: "Installatie binnen 1 werkdag.",
          code: "express",
        },
        prices: [
          {
            currency_code: "eur",
            amount: 249,
          },
          {
            region_id: region.id,
            amount: 249,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding stock location data.");

  logger.info("Seeding publishable API key data...");
  let publishableApiKey: ApiKey | null = null;
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id"],
    filters: {
      type: "publishable",
    },
  });

  publishableApiKey = data?.[0];

  if (!publishableApiKey) {
    const {
      result: [publishableApiKeyResult],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "Alterion Webshop",
            type: "publishable",
            created_by: "",
          },
        ],
      },
    });

    publishableApiKey = publishableApiKeyResult as ApiKey;
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding publishable API key data.");

  logger.info("Seeding Alterion product data...");

  const { result: categoryResult } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        {
          name: "Thuisbatterijen",
          is_active: true,
        },
      ],
    },
  });

  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Thuisbatterij Lite",
          category_ids: [categoryResult[0].id],
          description:
            "Compacte opslag (5kWh) voor kleinere huishoudens en appartementen. Ideaal als instapmodel voor slim energiebeheer.",
          handle: "thuisbatterij-lite",
          weight: 45000,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://lh3.googleusercontent.com/aida-public/AB6AXuBDYQOvNfAzDQrUUtlXVWBr6_OSf4gevdOi2w7V3tcKulAcxT8CIhELEVOUnsyD01vRvvYlu-Y2WgAWdabJs6WsgUZifk6iZQ71gSLYDXJqZzVOiUdmQeqKENdq9aCSpcAPtevTpdgj-Hv_BJRTAyjY9y6YSgx5LoS0DBVWunu399j54NW1yUgxv6f7yX8IZ5kwfe__nT2eLWlJYt2VzxhVNc-5ew5BaeltRPl9QqN9nRcXFzI-brHXr8cv77j3w1pRzWkCJ9aPTOiu",
            },
          ],
          options: [
            {
              title: "Capaciteit",
              values: ["5 kWh"],
            },
          ],
          variants: [
            {
              title: "5 kWh",
              sku: "ALT-LITE-5KWH",
              options: {
                Capaciteit: "5 kWh",
              },
              prices: [
                {
                  amount: 2499,
                  currency_code: "eur",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Thuisbatterij Pro",
          category_ids: [categoryResult[0].id],
          description:
            "De ideale balans (10kWh) voor het gemiddelde gezin met zonnepanelen. AI-gestuurd energiebeheer voor maximale besparing.",
          handle: "thuisbatterij-pro",
          weight: 94000,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://lh3.googleusercontent.com/aida-public/AB6AXuAcKsNhQWiLRyOe5H8Q3I0dvtlk9j4MjjCXL83PXgNCiApFJ55LtXcJ7fSW-wppiEZyt8NMFj3gys445zK1Myay_sbieDrtQpgji7XuEgCPnAAbQwomRZ2a0_mAcfFDlx8ustugGrPmXLwsk2-v39cpvfpckvt8Ou8IuGwbcs0PK_wYIVtuaDScHevNhm0AK-SzsLudEHuFTOgWwWLQoO_T2m96HnGTxsDoER_gVyUssHW8BMNYNkFswOweLLYQmGSRbyYUABu6s3Ey",
            },
          ],
          options: [
            {
              title: "Capaciteit",
              values: ["10 kWh"],
            },
          ],
          variants: [
            {
              title: "10 kWh",
              sku: "ALT-PRO-10KWH",
              options: {
                Capaciteit: "10 kWh",
              },
              prices: [
                {
                  amount: 4599,
                  currency_code: "eur",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Thuisbatterij Max",
          category_ids: [categoryResult[0].id],
          description:
            "Maximale capaciteit (20kWh+) voor volledige energie-onafhankelijkheid. De ultieme oplossing voor grote woningen.",
          handle: "thuisbatterij-max",
          weight: 150000,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://lh3.googleusercontent.com/aida-public/AB6AXuBdoiAWs5cTm_w4U4CYjhtFK-MHIFW1qSDpkhFo2hnyP4bYox_con-DugIDhw835ozargle4-0VvjMVPRfPt_4sOxUxRWZBcATw14UTsJrody_lVbv2E6ZDlBa5kX8SpM7ieprD4uYoOb_kLJc05XJniwwxtojKNuqgcVnOnyAx59IPdZbLy-CyODY9_gJ70dFiWGluF1jmdy10VjhKhL_guRdXJSBNAIazCVXTVBeoWSHDiVqMFz-X0OsuIZEvtSywjyC6mgewNVIq",
            },
          ],
          options: [
            {
              title: "Capaciteit",
              values: ["20 kWh"],
            },
          ],
          variants: [
            {
              title: "20 kWh",
              sku: "ALT-MAX-20KWH",
              options: {
                Capaciteit: "20 kWh",
              },
              prices: [
                {
                  amount: 7299,
                  currency_code: "eur",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
      ],
    },
  });
  logger.info("Finished seeding Alterion product data.");

  logger.info("Seeding inventory levels.");

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  const inventoryLevels: CreateInventoryLevelInput[] = [];
  for (const inventoryItem of inventoryItems) {
    const inventoryLevel = {
      location_id: stockLocation.id,
      stocked_quantity: 100,
      inventory_item_id: inventoryItem.id,
    };
    inventoryLevels.push(inventoryLevel);
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryLevels,
    },
  });

  logger.info("Finished seeding inventory levels data.");
  logger.info("Alterion seed complete!");
}

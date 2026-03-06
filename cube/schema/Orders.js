cube("Orders", {
  sql: `SELECT * FROM catalog.schema.orders`,

  measures: {
    count: {
      type: "count",
    },
    totalRevenue: {
      sql: "revenue",
      type: "sum",
    },
    avgOrderValue: {
      sql: "revenue",
      type: "avg",
    },
  },

  dimensions: {
    id: {
      sql: "order_id",
      type: "number",
      primaryKey: true,
    },
    status: {
      sql: "status",
      type: "string",
    },
    productCategory: {
      sql: "product_category",
      type: "string",
    },
    region: {
      sql: "region",
      type: "string",
    },
    createdAt: {
      sql: "created_at",
      type: "time",
    },
  },
});

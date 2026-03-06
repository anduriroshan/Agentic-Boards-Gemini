cube("Customers", {
  sql: `SELECT * FROM catalog.schema.customers`,

  measures: {
    count: {
      type: "count",
    },
    totalLifetimeValue: {
      sql: "lifetime_value",
      type: "sum",
    },
  },

  dimensions: {
    id: {
      sql: "customer_id",
      type: "number",
      primaryKey: true,
    },
    name: {
      sql: "name",
      type: "string",
    },
    email: {
      sql: "email",
      type: "string",
    },
    segment: {
      sql: "segment",
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

  joins: {
    Orders: {
      relationship: "hasMany",
      sql: `${CUBE}.customer_id = ${Orders}.customer_id`,
    },
  },
});

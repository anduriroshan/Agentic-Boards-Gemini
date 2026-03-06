/** @type {import('@cubejs-backend/server-core').CubejsConfiguration} */
module.exports = {
  dbType: "databricks-jdbc",
  driverFactory: () => {
    const DatabricksDriver = require("@cubejs-backend/databricks-jdbc-driver");
    return new DatabricksDriver({
      url: process.env.CUBEJS_DB_DATABRICKS_URL,
      token: process.env.CUBEJS_DB_DATABRICKS_TOKEN,
    });
  },
  apiSecret: process.env.CUBEJS_API_SECRET,
  externalDefault: false,
  scheduledRefreshTimer: false,
};

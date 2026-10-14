// Extends app.json. The web build is hosted under a sub-path on GitHub Pages
// (https://tiltedtomftw.github.io/ShineTime/app/), so the Pages workflow sets
// EXPO_BASE_URL at export time. Local dev leaves it unset and serves from "/".
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_BASE_URL;
  if (!baseUrl) return config;
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};

/** Visual A/B edition only: course geometry, controls and race timing are shared. */
export const isFoundryEdition = typeof location !== "undefined"
  && new URLSearchParams(location.search).get("edition") === "foundry";

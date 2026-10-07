import { defineComponents } from "blume";
import HeaderSearch from "./components/HeaderSearch.astro";
import HomeBanner from "./components/HomeBanner.astro";

export default defineComponents({
  layout: {
    PageHeader: HomeBanner,
    Search: HeaderSearch,
  },
});

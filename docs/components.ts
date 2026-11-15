import HomeBanner from "@timmo001/docs-kit/blume/home-banner.astro";
import { defineComponents } from "blume";
import HeaderSearch from "./header-search.astro";

export default defineComponents({
  layout: {
    PageHeader: HomeBanner,
    Search: HeaderSearch,
  },
});

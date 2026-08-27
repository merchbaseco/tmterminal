import "@fontsource-variable/archivo";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import "./custom.css";
import TrademarkLogo from "./TrademarkLogo.vue";

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "nav-bar-title-before": () => h(TrademarkLogo),
    }),
};

export default theme;

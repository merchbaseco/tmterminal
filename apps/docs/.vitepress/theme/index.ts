import "@fontsource-variable/archivo";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import "./custom.css";

const TrademarkLogo = () =>
  h("span", { "aria-hidden": "true", class: "tt-logo" }, [
    h("span", { class: "tt-logo-word" }, "TRADEMARK"),
    h(
      "svg",
      {
        "aria-hidden": "true",
        class: "tt-logo-mark",
        fill: "none",
        viewBox: "0 0 24 24",
      },
      [
        h("rect", {
          height: "14",
          rx: "2",
          stroke: "currentColor",
          "stroke-width": "2",
          width: "18",
          x: "3",
          y: "4",
        }),
        h("path", {
          d: "M7 9l3 2.2L7 13.4",
          stroke: "currentColor",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "stroke-width": "2",
        }),
        h("path", {
          d: "M12 14.2h5",
          stroke: "currentColor",
          "stroke-linecap": "round",
          "stroke-width": "2",
        }),
      ]
    ),
  ]);

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "nav-bar-title-before": () => h(TrademarkLogo),
    }),
};

export default theme;

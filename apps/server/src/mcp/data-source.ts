import type {
  MarkDetail,
  MatchTextsInput,
  ScreenTextInput,
  ScreenTextResult,
  ScreenTextsResult,
  SearchInput,
  SearchPage,
} from "../api/contracts.ts";
import type { AppContext } from "../api/router.ts";
import { authenticatedClientRouter } from "../api/router.ts";
import { summarizeScreenedTexts } from "../api/screen-text.ts";

export interface TmterminalMcpDataSource {
  trademarks: {
    get: (input: { registrationNumber: string } | { serialNumber: string }) => Promise<MarkDetail>;
    screen: (input: ScreenTextInput) => Promise<ScreenTextResult>;
    screenTexts: (input: MatchTextsInput) => Promise<ScreenTextsResult>;
    search: (input: SearchInput) => Promise<SearchPage>;
  };
}

export function createTmterminalMcpDataSource(context: AppContext): TmterminalMcpDataSource {
  const caller = authenticatedClientRouter.createCaller(context);

  return {
    trademarks: {
      get: caller.marks.get,
      screen: caller.marks.screenText,
      screenTexts: async (input) => summarizeScreenedTexts(await caller.marks.match(input)),
      search: caller.marks.search,
    },
  };
}

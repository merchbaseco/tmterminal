import type {
  MarkDetail,
  ScreenTextInput,
  ScreenTextResult,
  SearchInput,
  SearchPage,
} from "../api/contracts.ts";
import type { AppContext } from "../api/router.ts";
import { authenticatedClientRouter } from "../api/router.ts";

export interface TmterminalMcpDataSource {
  trademarks: {
    get: (input: { registrationNumber: string } | { serialNumber: string }) => Promise<MarkDetail>;
    screen: (input: ScreenTextInput) => Promise<ScreenTextResult>;
    search: (input: SearchInput) => Promise<SearchPage>;
  };
}

export function createTmterminalMcpDataSource(context: AppContext): TmterminalMcpDataSource {
  const caller = authenticatedClientRouter.createCaller(context);

  return {
    trademarks: {
      get: caller.marks.get,
      screen: caller.marks.screenText,
      search: caller.marks.search,
    },
  };
}

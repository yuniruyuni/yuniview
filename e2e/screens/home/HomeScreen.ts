import type { Page } from "@playwright/test";
import { BaseScreen } from "../../base/BaseScreen";
import { HomeActions } from "./HomeActions";
import { HomePage } from "./HomePage";
import { HomeState } from "./HomeState";

export class HomeScreen extends BaseScreen<HomePage, HomeActions, HomeState> {
  constructor(page: Page) {
    super(page, new HomePage(page), new HomeActions(page), new HomeState(page));
  }
}

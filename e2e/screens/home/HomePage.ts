import { BasePage } from "../../base/BasePage";

export class HomePage extends BasePage {
  get main() {
    return this.getLocator("main");
  }
}

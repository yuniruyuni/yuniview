import { BaseActions } from "../../base/BaseActions";

export class HomeActions extends BaseActions {
  async goToHomePage(): Promise<void> {
    await this.navigate("/");
    await this.waitForLoadState("domcontentloaded");
  }
}

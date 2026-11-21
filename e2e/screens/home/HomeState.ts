import { BaseState } from "../../base/BaseState";

export class HomeState extends BaseState {
  async expectHomePageTitle(): Promise<void> {
    await this.expectTitle("yuniview");
  }
}

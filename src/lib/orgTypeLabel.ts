import type { TFunction } from "i18next";

export function orgTypeLabel(orgType: string, t: TFunction): string {
  return t(`orgManager.orgType.${orgType}`, { defaultValue: orgType });
}

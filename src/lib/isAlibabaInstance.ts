/** Detect whether a Salesforce instance URL belongs to Alibaba Cloud. */
export function isAlibabaInstance(instanceUrl: string): boolean {
  const url = instanceUrl.toLowerCase();
  return (
    url.includes(".my.sfcrmproducts.cn") ||
    url.includes(".sfbest.cn") ||
    url.includes(".sfdc.cn") ||
    url.includes(".sfcrm.cn")
  );
}

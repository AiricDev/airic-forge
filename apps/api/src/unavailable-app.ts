import type { AppPort } from "@airic-forge/domain";
/** OM initialization is offline. No App operation is available in this mode. */
export function unavailableApp(): AppPort {
  const fail = async (): Promise<never> => {
    throw Error("OfflineAppOperationDenied");
  };
  return {
    identity: fail,
    resourceContext: fail,
    discoverTools: fail,
    query: fail,
    prepareCommand: fail,
    submitCommand: fail,
    receipt: fail,
  };
}

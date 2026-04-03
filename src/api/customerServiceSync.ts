const BASE_PATH = '/api/customer-service-cloud/config';

type CloudSyncRecord = {
  settings: unknown;
  ownerId?: string;
  version: number;
  updatedAt: number;
};

export type CloudConfigResponse = CloudSyncRecord & {
  canUpdate?: boolean;
};

type UploadRequestPayload = {
  ownerId: string;
  settings: unknown;
};

type UploadResponse = {
  version: number;
  updatedAt: number;
  ownerId: string;
};

export async function fetchCustomerServiceCloudConfig(
  token: string,
  currentUserId?: string,
): Promise<CloudConfigResponse | undefined> {
  const query = new URLSearchParams({ token });
  if (currentUserId) {
    query.set('currentUserId', currentUserId);
  }

  const response = await fetch(`${BASE_PATH}?${query.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `Cloud sync fetch failed: ${response.status}`);
  }

  return data?.record;
}

export async function uploadCustomerServiceCloudConfig(
  token: string,
  payload: UploadRequestPayload,
): Promise<UploadResponse> {
  const response = await fetch(BASE_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token,
      ...payload,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `Cloud sync upload failed: ${response.status}`);
  }

  return data;
}

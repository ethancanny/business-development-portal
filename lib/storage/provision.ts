import { listRooms, stampRoomStorage } from "../dataroom/service";
import { ensureSharePointDrive } from "./sharepoint";

/**
 * SharePoint provisioning pass (Oct 23, 2026): resolve the site,
 * create the portal's document library if it is missing, and stamp
 * every data room to the SharePoint provider (provider_ref = drive
 * id). Triggered by an admin from Settings → Integrations via
 * POST /api/platform/storage/provision — deliberately a button, not
 * a silent side effect, so the flip to SharePoint storage is a
 * visible, auditable step. Safe to re-run: the library lookup is
 * by name and room stamps are idempotent.
 */

export interface SharePointProvisionReport {
  siteName: string;
  siteId: string;
  driveName: string;
  driveId: string;
  roomsTotal: number;
  roomsStamped: number;
}

export async function provisionSharePointStorage(): Promise<SharePointProvisionReport> {
  const drive = await ensureSharePointDrive(true);
  if (!drive) {
    throw new Error("SharePoint drive could not be resolved or created");
  }
  let roomsTotal = 0;
  let roomsStamped = 0;
  const pageSize = 50;
  for (let offset = 0; ; offset += pageSize) {
    const { items, total } = await listRooms({ limit: pageSize, offset });
    roomsTotal = total;
    for (const room of items) {
      await stampRoomStorage(room.id, "sharepoint", drive.driveId);
      roomsStamped++;
    }
    if (offset + items.length >= total || items.length === 0) break;
  }
  return {
    siteName: drive.site.displayName,
    siteId: drive.site.id,
    driveName: drive.driveName,
    driveId: drive.driveId,
    roomsTotal,
    roomsStamped,
  };
}

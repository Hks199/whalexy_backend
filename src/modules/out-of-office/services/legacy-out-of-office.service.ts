import { getAwaySettings } from '../out-of-office.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
/** Original page URL exposes configuration JSON until its view/session port is verified. */
export async function readLegacyAwaySettings(input: ServiceContext) {
  const result = await getAwaySettings(input),
    data = result.body as any,
    settings = data.settings;
  return serviceResult(
    {
      settings: {
        enabled: settings.enabled,
        message: settings.message,
        timezone: settings.timezone,
        mode: settings.mode,
        manual_until: settings.manualUntil ?? null,
        manual_started_at: settings.manualStartedAt ?? null,
        whatsapp_phone_number_id: data.phone_number_id,
      },
      schedule: data.schedule,
      status: data.status,
      phone_number_id: data.phone_number_id,
    },
    { status: 200, format: 'json' },
  );
}

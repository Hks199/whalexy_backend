import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { readSiteSettings } from '../../configuration/services/site-settings.js';
import { registerBodySchema } from '../auth.validation.js';
import { login, register, logout } from '../auth.service.js';

export async function loginLegacyUser(input: ServiceContext) {
  const result = await login({
    ...input,
    body: {
      ...input.body,
      email: input.body.email.includes('@') ? input.body.email.toLowerCase() : input.body.email,
    },
  });
  return serviceResult({ reaction: 1, data: result.body }, { status: 200, format: 'json' });
}
export async function prepareLegacyRegistration() {
  const { settings } = await readSiteSettings([
    'enable_vendor_registration',
    'message_for_disabled_registration',
  ]);
  return serviceResult(
    {
      reaction: 1,
      data: {
        registration_enabled: settings.enable_vendor_registration,
        disabled_message: settings.message_for_disabled_registration,
        required_fields: ['name', 'email', 'password', 'phone_number', 'business_name'],
        verification_required: ['email', 'phone'],
      },
    },
    { status: 200, format: 'json' },
  );
}
export async function registerLegacyUser(input: ServiceContext) {
  const body = input.body;
  const checked = registerBodySchema.validate({
    name: body.name ?? [body.first_name, body.last_name].filter(Boolean).join(' '),
    email: body.email,
    password: body.password,
    phoneNumber: body.phone_number ?? body.mobile_number,
    businessName: body.business_name,
  });
  if (checked.error)
    throw new ApiError(400, 'VALIDATION_FAILED', 'Registration fields are invalid');
  const result = await register({ ...input, body: checked.value });
  return serviceResult(
    { reaction: 1, data: result.body },
    { status: result.status, format: 'json' },
  );
}
export async function logoutLegacyUser(input: ServiceContext) {
  await logout(input);
  return serviceResult(
    { reaction: 1, data: {}, message: 'Logged out' },
    { status: 200, format: 'json' },
  );
}
export async function getLegacyCurrentUser(input: ServiceContext) {
  const user = await db.users.findUniqueOrThrow({
    where: { id: input.identity!.userId },
    select: {
      id: true,
      uid: true,
      name: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
      phoneNumber: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  });
  return serviceResult(
    {
      _id: user.id,
      _uid: user.uid,
      name: user.name,
      first_name: user.firstName,
      last_name: user.lastName,
      username: user.username,
      email: user.email,
      mobile_number: user.phoneNumber,
      email_verified_at: user.emailVerifiedAt,
      phone_verified_at: user.phoneVerifiedAt,
    },
    { status: 200, format: 'json' },
  );
}

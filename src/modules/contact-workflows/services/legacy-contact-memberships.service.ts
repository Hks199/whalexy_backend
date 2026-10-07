import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { changeContactGroupMemberships } from './contact-group-membership.service.js';
export async function assignGroups(input: ServiceContext) {
  const result = await changeContactGroupMemberships(
    input,
    input.body.selected_contacts,
    input.body.selected_groups,
    'add',
    true,
  );
  return serviceResult(
    {
      status: 'success',
      message: result.affectedMemberships ? 'Groups assigned successfully.' : 'No changes',
      ...result,
      reloadDatatableId: '#lwContactList',
      modalId: '#lwAssignGroups',
    },
    { status: 200, format: 'json' },
  );
}
export async function removeGroup(input: ServiceContext) {
  const result = await changeContactGroupMemberships(
    input,
    [input.params.contactIdOrUid],
    [input.params.groupUid],
    'remove',
  );
  return serviceResult(
    {
      status: 'success',
      message: result.affectedMemberships ? 'Contact removed successfully.' : 'No changes',
      ...result,
    },
    { status: 200, format: 'json' },
  );
}

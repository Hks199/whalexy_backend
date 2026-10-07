import { setTimeout } from 'node:timers/promises';
import { db } from './database/client.js';
import { logger } from './observability/logger.js';
import { runOneJob } from './jobs/runner.js';
import { recoverInterruptedJobs } from './jobs/recovery.js';
import { dispatchDueCampaigns } from './modules/campaigns/services/campaign-delivery.service.js';
import { dispatchDueReminders } from './modules/appointment-reminders/appointment-reminders.service.js';
import { publishScheduledPosts } from './modules/content/services/blog-posts.service.js';

let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
await db.$connect();
logger.info('worker started');
// A dead worker may have completed an external effect. Never automatically resend it.
await recoverInterruptedJobs();
let lastSchedule = 0;
while (!stopped) {
  try {
    if (Date.now() - lastSchedule > 60000) {
      await dispatchDueCampaigns();
      await dispatchDueReminders();
      await publishScheduledPosts();
      lastSchedule = Date.now();
    }
    if (!(await runOneJob())) await setTimeout(1000);
  } catch {
    logger.error('worker database operation failed');
    await setTimeout(5000);
  }
}
await db.$disconnect();
logger.info('worker stopped');

# Backend conversion audit

**Fully converted: no.**

Source: `D:\mombius bloom\whalexy`. Found 33 modules, 648 route declarations, 592 public controller methods and 125 table names.

Prisma has 138 models, including native operational models. 1 source tables lack an available creation migration or SQLite snapshot definition. 0 models have at most two scalar fields and require schema reconciliation.

Original database files found: 1. Laravel vendor/autoload.php available: False.

## Module coverage

| Source module | Public controller methods | Node status | Full parity verified |
|---|---:|---|---|
| AdsManager | 19 | partial-native-implementation | No |
| AIIntelligence | 12 | partial-native-implementation | No |
| Appointment | 27 | partial-native-implementation | No |
| Auth | 29 | partial-native-implementation | No |
| Blog | 20 | partial-native-implementation | No |
| BotReply | 18 | partial-native-implementation | No |
| Campaign | 13 | partial-native-implementation | No |
| Catalog | 13 | partial-native-implementation | No |
| CommentToDm | 11 | partial-native-implementation | No |
| Configuration | 10 | partial-native-implementation | No |
| Contact | 41 | partial-native-implementation | No |
| ConversationClassification | 3 | partial-native-implementation | No |
| CXScore | 8 | partial-native-implementation | No |
| Dashboard | 5 | partial-native-implementation | No |
| FacebookChatService | 14 | partial-native-implementation | No |
| FacebookService | 15 | partial-native-implementation | No |
| Flows | 20 | partial-native-implementation | No |
| Guide | 1 | partial-native-implementation | No |
| Home | 13 | partial-native-implementation | No |
| InstagramService | 24 | partial-native-implementation | No |
| Integration | 39 | partial-native-implementation | No |
| LiveChat | 6 | no-dedicated-port | No |
| Media | 9 | partial-native-implementation | No |
| MetaChannel | 7 | partial-native-implementation | No |
| OutOfOffice | 2 | partial-native-implementation | No |
| Page | 7 | partial-native-implementation | No |
| Sheets | 5 | partial-native-implementation | No |
| Subscription | 36 | partial-native-implementation | No |
| TallyIntegration | 4 | partial-native-implementation | No |
| Translation | 11 | partial-native-implementation | No |
| User | 20 | partial-native-implementation | No |
| Vendor | 24 | partial-native-implementation | No |
| WhatsAppService | 73 | partial-native-implementation | No |

## Source preservation

Hashed 767 original backend/test files. Changes since the audit snapshot: 0.

## Database review required

Creation definitions missing for: token_registry.

Minimal reconstructed models: none detected by the scalar-count heuristic; this does not validate their definitions.

This report is conservative. A generic data endpoint is not a converted provider workflow. See FEATURE_PARITY.md for the remaining work.

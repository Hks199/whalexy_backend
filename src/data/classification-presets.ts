export const classificationPresets = {
  intent: {
    Sales: {
      'New Inquiry': {
        color: '#3b82f6',
        icon: 'fa-star',
      },
      'Product Inquiry': {
        color: '#2563eb',
        icon: 'fa-box',
      },
      'Pricing Inquiry': {
        color: '#1d4ed8',
        icon: 'fa-tag',
      },
      'Demo Request': {
        color: '#8b5cf6',
        icon: 'fa-laptop',
      },
      'Quote Request': {
        color: '#0284c7',
        icon: 'fa-file-invoice-dollar',
      },
      'Bulk Order': {
        color: '#059669',
        icon: 'fa-boxes',
      },
      'Deal On (Hot Lead)': {
        color: '#ea580c',
        icon: 'fa-fire',
      },
      'Deal Off (Lost Opportunity)': {
        color: '#dc2626',
        icon: 'fa-times-circle',
      },
    },
    'Customer Support': {
      'Technical Issue': {
        color: '#d97706',
        icon: 'fa-wrench',
      },
      Complaint: {
        color: '#dc2626',
        icon: 'fa-exclamation-triangle',
      },
      Feedback: {
        color: '#0284c7',
        icon: 'fa-comment-alt',
      },
      'Feature Request': {
        color: '#7c3aed',
        icon: 'fa-lightbulb',
      },
      'Bug Report': {
        color: '#e11d48',
        icon: 'fa-bug',
      },
      'Refund Request': {
        color: '#b91c1c',
        icon: 'fa-hand-holding-usd',
      },
      'Return Request': {
        color: '#c05621',
        icon: 'fa-undo',
      },
      'Cancellation Request': {
        color: '#9f1239',
        icon: 'fa-ban',
      },
    },
    'Existing Customer': {
      'Service Purchased': {
        color: '#16a34a',
        icon: 'fa-check-circle',
      },
      'Payment Query': {
        color: '#0891b2',
        icon: 'fa-credit-card',
      },
      'Subscription Renewal': {
        color: '#2563eb',
        icon: 'fa-sync',
      },
      'Upgrade Request': {
        color: '#7c3aed',
        icon: 'fa-arrow-up',
      },
      'Downgrade Request': {
        color: '#64748b',
        icon: 'fa-arrow-down',
      },
    },
    General: {
      Greeting: {
        color: '#64748b',
        icon: 'fa-hand-wave',
      },
      'Follow-up': {
        color: '#475569',
        icon: 'fa-thumbtack',
      },
      'Documentation Request': {
        color: '#475569',
        icon: 'fa-book',
      },
      'Partnership Inquiry': {
        color: '#0d9488',
        icon: 'fa-handshake',
      },
      Other: {
        color: '#64748b',
        icon: 'fa-ellipsis-h',
      },
    },
  },
  sentiment: {
    'Very Positive': {
      color: '#10b981',
      badge_bg: '#d1fae5',
      badge_text: '#065f46',
      icon: 'fa-laugh-beam',
    },
    Positive: {
      color: '#00C951',
      badge_bg: '#dcfce7',
      badge_text: '#15803d',
      icon: 'fa-smile',
    },
    Neutral: {
      color: '#64748b',
      badge_bg: '#f1f5f9',
      badge_text: '#475569',
      icon: 'fa-meh',
    },
    Frustrated: {
      color: '#f59e0b',
      badge_bg: '#fef3c7',
      badge_text: '#b45309',
      icon: 'fa-frown',
    },
    Negative: {
      color: '#ef4444',
      badge_bg: '#fee2e2',
      badge_text: '#b91c1c',
      icon: 'fa-angry',
    },
    'Very Angry': {
      color: '#991b1b',
      badge_bg: '#ffe4e6',
      badge_text: '#881337',
      icon: 'fa-flushed',
    },
  },
  urgency: {
    Critical: {
      color: '#e11d48',
      badge_bg: '#ffe4e6',
      badge_text: '#9f1239',
      icon: 'fa-bolt',
    },
    High: {
      color: '#f97316',
      badge_bg: '#ffedd5',
      badge_text: '#c2410c',
      icon: 'fa-fire',
    },
    Medium: {
      color: '#eab308',
      badge_bg: '#fef9c3',
      badge_text: '#a16207',
      icon: 'fa-exclamation',
    },
    Low: {
      color: '#0ea5e9',
      badge_bg: '#e0f2fe',
      badge_text: '#0369a1',
      icon: 'fa-minus',
    },
    'No Action Required': {
      color: '#94a3b8',
      badge_bg: '#f1f5f9',
      badge_text: '#475569',
      icon: 'fa-check',
    },
  },
  risk_level: {
    'Critical Risk': {
      color: '#881337',
      badge_bg: '#ffe4e6',
      badge_text: '#881337',
      icon: 'fa-radiation',
    },
    'High Risk': {
      color: '#dc2626',
      badge_bg: '#fee2e2',
      badge_text: '#b91c1c',
      icon: 'fa-exclamation-triangle',
    },
    'Medium Risk': {
      color: '#d97706',
      badge_bg: '#fef3c7',
      badge_text: '#b45309',
      icon: 'fa-shield-alt',
    },
    'Low Risk': {
      color: '#0d9488',
      badge_bg: '#ccfbf1',
      badge_text: '#0f766e',
      icon: 'fa-shield-virus',
    },
    'No Risk': {
      color: '#16a34a',
      badge_bg: '#dcfce7',
      badge_text: '#15803d',
      icon: 'fa-user-shield',
    },
  },
} as const;

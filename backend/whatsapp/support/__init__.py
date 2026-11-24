"""WhatsApp Support: the AI customer support agent on the ExtraHand WhatsApp number (Customer Engagement → WhatsApp Support).

A registered customer writes to the business number in Telugu, Hindi or English (also Telugu / Hindi in English letters).
The agent answers in the same language from the customer's own ExtraHand data (read through the ExtraHand Main Admin
API, never another customer's), takes cancel / reschedule requests after an explicit YES, records complaints and hands
anything it cannot solve to the Customer Care team as a case (app/api/escalations.py).

Modules:
  settings.py       on/off, test mode and test numbers (starts OFF and in test mode)
  language.py       language detection (script + romanised Telugu / Hindi words) and YES / NO words
  intents.py        rule-based intent detection (the fallback when the AI is unavailable)
  customer_data.py  the sender's own account and bookings, matched on the WhatsApp phone number
  agent.py          the AI (OpenRouter) that writes the reply and picks one safe action
  tickets.py        Customer Care cases from WhatsApp + notifying the care team (human handover)
  webhook.py        incoming messages: signature check, routing, duplicate protection, sending the reply
  router.py         /api/wa-support/* for the WhatsApp Support pages
"""

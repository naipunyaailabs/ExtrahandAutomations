"""In-memory stand-in for the ExtraHand APIs (EXTRAHAND_MODE=mock).

Responses are shaped like plausible ExtraHand payloads so they go through the
same normalizers as live data."""

import copy
import math
import threading
from datetime import UTC, datetime, timedelta

from .extrahand import CandidatesUnavailable, ExtraHandError

CUSTOMERS = [
    ("cust_001", "Ananya Reddy", "9876500001", "ananya@example.com"),
    ("cust_002", "Rahul Verma", "9876500002", "rahul@example.com"),
    ("cust_003", "Priya Sharma", "9876500003", "priya@example.com"),
    ("cust_004", "Kiran Kumar", "9876500004", "kiran@example.com"),
    ("cust_005", "Meera Iyer", "9876500005", "meera@example.com"),
    ("cust_006", "Arjun Rao", "9876500006", "arjun@example.com"),
]

# uid, name, phone, skills, city, lat, lng
HELPERS = [
    ("helper_001", "Ravi Teja", "9000000001", ["Cleaning", "Deep Cleaning"], "Hyderabad", 17.4401, 78.3489),
    ("helper_002", "Suresh Babu", "9000000002", ["Plumbing"], "Hyderabad", 17.4486, 78.3908),
    ("helper_003", "Lakshmi Devi", "9000000003", ["Cleaning", "Cooking"], "Hyderabad", 17.4239, 78.4738),
    ("helper_004", "Mahesh Goud", "9000000004", ["Electrical", "AC Repair"], "Hyderabad", 17.4933, 78.3915),
    ("helper_005", "Venkat Rao", "9000000005", ["Plumbing", "Carpentry"], "Hyderabad", 17.3850, 78.4867),
    ("helper_006", "Sunitha", "9000000006", ["Cleaning"], "Hyderabad", 17.4560, 78.3670),
    ("helper_007", "Imran Khan", "9000000007", ["Electrical"], "Hyderabad", 17.3616, 78.4747),
    ("helper_008", "Naveen", "9000000008", ["Moving", "Packing"], "Hyderabad", 17.4126, 78.4071),
    ("helper_009", "Rajesh", "9000000009", ["Cleaning", "Deep Cleaning"], "Bengaluru", 12.9716, 77.5946),
    ("helper_010", "Deepa", "9000000010", ["Cooking"], "Bengaluru", 12.9352, 77.6245),
    ("helper_011", "Manjunath", "9000000011", ["Plumbing", "Electrical"], "Bengaluru", 12.9698, 77.7500),
    ("helper_012", "Farhan", "9000000012", ["AC Repair"], "Hyderabad", 17.4700, 78.3600),
]

# id, title, category, customer, hours from now, budget, address, city, lat, lng, assigned helper
TASKS = [
    ("task_1001", "Full home deep cleaning (2BHK)", "Deep Cleaning", "cust_001", 1.6, 2499,
     "Flat 302, My Home Avatar, Narsingi", "Hyderabad", 17.3990, 78.3560, None),
    ("task_1002", "Kitchen sink leakage repair", "Plumbing", "cust_002", 3, 599,
     "H.No 8-2-120, Banjara Hills Rd 2", "Hyderabad", 17.4156, 78.4347, None),
    ("task_1003", "Ceiling fan installation x2", "Electrical", "cust_003", 26, 450,
     "Plot 44, Kondapur Main Rd", "Hyderabad", 17.4622, 78.3568, "helper_004"),
    ("task_1004", "Daily cook for family of 4", "Cooking", "cust_004", 2.5, 1200,
     "12th Main, Indiranagar", "Bengaluru", 12.9719, 77.6412, None),
    ("task_1005", "Bathroom cleaning", "Cleaning", "cust_005", 1.2, 699,
     "Gachibowli, DLF Cyber City Rd", "Hyderabad", 17.4435, 78.3772, "helper_006"),
    ("task_1006", "Split AC service", "AC Repair", "cust_006", 30, 799,
     "Madhapur, Ayyappa Society", "Hyderabad", 17.4483, 78.3915, None),
    ("task_1007", "Shift 1BHK to new flat", "Moving", "cust_001", 48, 4500,
     "Ameerpet Metro, Hyderabad", "Hyderabad", 17.4375, 78.4482, None),
    ("task_1008", "Water heater wiring", "Electrical", "cust_003", 6, 650,
     "Whitefield, ITPL Main Rd", "Bengaluru", 12.9698, 77.7499, None),
    ("task_1009", "Lawn trimming and hedge cutting", "Garden Care", "cust_002", 20, 999,
     "Jubilee Hills Rd 36", "Hyderabad", 17.4300, 78.4070, None),
]


def _km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class MockExtraHand:
    mode = "mock"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        now = datetime.now(UTC).replace(second=0, microsecond=0)
        self.customers = {
            cid: {"_id": f"p_{cid}", "uid": cid, "name": n, "phone": ph, "email": em, "role": "customer", "status": "active"}
            for cid, n, ph, em in CUSTOMERS
        }
        areas_hyd = ["Madhapur", "Gachibowli", "Hitec City", "Kondapur", "Banjara Hills"]
        areas_blr = ["Indiranagar", "Koramangala", "Whitefield", "HSR Layout"]
        self.helpers = {}
        for idx, (uid, n, ph, skills, city, lat, lng) in enumerate(HELPERS):
            is_hyd = city == "Hyderabad"
            state = "Telangana" if is_hyd else "Karnataka"
            pin = "500081" if is_hyd else "560038"
            areas = areas_hyd[:3] if is_hyd else areas_blr[:3]
            cats = list(dict.fromkeys([s.split()[0] if " " in s else s for s in skills]))
            self.helpers[uid] = {
                "_id": f"p_{uid}",
                "uid": uid,
                "name": n,
                "phone": ph,
                "email": f"{n.lower().replace(' ', '.')}@example.com",
                "role": "partner",
                "roles": ["partner", "tasker"],
                "status": "active",
                "isActive": True,
                "isAadhaarVerified": idx % 4 != 3,  # mostly verified
                "roleVerifications": {
                    "tasker": {
                        "canAcceptTasks": idx % 6 != 5  # mostly ready to accept
                    }
                },
                "skills": skills,
                "categories": cats,
                "partnerProfile": {
                    "status": "active",
                    "categories": cats,
                    "skills": skills,
                    "workAreas": areas,
                    "workShiftType": "full_time" if idx % 2 == 0 else "part_time",
                },
                "address": {"city": city, "state": state, "pincode": pin, "line1": f"{areas[0]}, {city}"},
                "location": {
                    "type": "Point",
                    "coordinates": [lng, lat],
                    "addressDetails": {
                        "area": areas[0],
                        "city": city,
                        "state": state,
                        "pinCode": pin,
                    },
                },
            }
        self.tasks: dict[str, dict] = {}
        for tid, title, cat, cust, hrs, budget, addr, city, lat, lng, helper in TASKS:
            c = self.customers[cust]
            task = {
                "_id": tid, "title": title, "description": f"{title} requested via team booking.",
                "category": {"name": cat}, "status": "assigned" if helper else "open",
                "budget": {"amount": budget, "currency": "INR"},
                "scheduledDate": (now + timedelta(hours=hrs)).isoformat().replace("+00:00", "Z"),
                "location": {"address": addr, "city": city, "type": "Point", "coordinates": [lng, lat]},
                "customerId": cust, "customer": {"uid": cust, "name": c["name"], "phone": c["phone"]},
                "bookingSource": "team", "createdAt": now.isoformat(), "updatedAt": now.isoformat(),
            }
            if helper:
                self._set_assignee(task, self.helpers[helper])
            self.tasks[tid] = task

    @staticmethod
    def _set_assignee(task: dict, h: dict) -> None:
        task["assigneeId"] = h["uid"]
        task["assignee"] = {"uid": h["uid"], "_id": h["_id"], "name": h["name"], "phone": h["phone"]}
        task["status"] = "assigned"
        task["updatedAt"] = datetime.now(UTC).isoformat()

    def iter_tasks(self, max_pages: int = 50) -> list[dict]:
        with self._lock:
            # Listing returns a lighter object; details come from get_task
            return [{k: v for k, v in copy.deepcopy(t).items() if k != "description"} for t in self.tasks.values()]

    def get_task(self, task_id: str) -> dict:
        with self._lock:
            if task_id not in self.tasks:
                raise ExtraHandError(f"task {task_id} not found")
            return copy.deepcopy(self.tasks[task_id])

    def get_user(self, user_id: str) -> dict:
        u = self.customers.get(user_id) or self.helpers.get(user_id)
        if not u:
            raise ExtraHandError(f"user {user_id} not found")
        return copy.deepcopy(u)

    def list_users(self, role: str, max_pages: int = 10) -> list[dict]:
        pool = self.customers if role == "customer" else self.helpers
        return copy.deepcopy(list(pool.values()))

    def search_helpers(self, q: str) -> list[dict]:
        q = q.lower()
        return [copy.deepcopy(h) for h in self.helpers.values() if q in h["name"].lower() or q in h["phone"]][:20]

    def get_candidates(self, task_id: str, lat: float | None, lng: float | None, radius_km: float) -> list[dict]:
        with self._lock:
            task = self.tasks.get(task_id)
        if not task:
            raise CandidatesUnavailable(f"task {task_id} not found in mock store")
        tlng, tlat = task["location"]["coordinates"]
        lat, lng = lat if lat is not None else tlat, lng if lng is not None else tlng
        cat = task["category"]["name"].lower()
        out = []
        for h in self.helpers.values():
            if not any(cat in s.lower() or s.lower() in cat for s in h["skills"]):
                continue
            hlng, hlat = h["location"]["coordinates"]
            d = _km(lat, lng, hlat, hlng)
            if d <= radius_km:
                out.append({**copy.deepcopy(h), "distanceKm": round(d, 2)})
        return sorted(out, key=lambda c: c["distanceKm"])

    def assign_helper(self, task_id: str, helper_uid: str, helper_profile_id: str | None, helper_name: str | None) -> dict:
        with self._lock:
            task, h = self.tasks.get(task_id), self.helpers.get(helper_uid)
            if not task or not h:
                raise ExtraHandError("task or helper not found")
            self._set_assignee(task, h)
            return {"success": True, "data": copy.deepcopy(task)}

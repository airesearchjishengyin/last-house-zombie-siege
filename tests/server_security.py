import unittest

import server


def state():
    return {
        "mission": "destroy",
        "map": "river",
        "last_posture": "SCOUT",
        "wave": 1,
        "seconds_into_wave": 12,
        "survivors": 18,
        "initial_humans": 18,
        "rooms_searched": 1,
        "rooms_total": 6,
        "visible_zombies": 2,
        "zombies_near_house": 0,
        "immediate_zombie_count": 0,
        "squad_in_contact_danger": 0,
        "squad_low_ammo": 0,
        "squad_scattered": 1,
        "average_distance_to_objective": 210,
        "seconds_in_current_action": 4,
        "kills_in_current_action": 1,
        "squad_moved_in_current_action": 42,
        "ammo_mode": "finite",
        "mission_stage": "search",
        "mother_core_visible": False,
        "objective_integrity": None,
        "threat_by_lane": {"north": 1, "east": 0, "south": 1, "west": 0},
        "unexpected": "ignored",
    }


class PublicDecisionRequestTests(unittest.TestCase):
    def test_valid_state_is_reduced_to_known_fields(self):
        result = server.sanitize_state(state())
        self.assertEqual(result["mission"], "destroy")
        self.assertNotIn("unexpected", result)
        self.assertEqual(server.decision_question(result)["criteria"].keys(), {"SCOUT"})

    def test_rejects_invalid_control_fields_and_counts(self):
        invalid = state()
        invalid["mission"] = "admin"
        with self.assertRaises(ValueError):
            server.sanitize_state(invalid)
        invalid = state()
        invalid["visible_zombies"] = "many"
        with self.assertRaises(ValueError):
            server.sanitize_state(invalid)

    def test_per_ip_budget_limits_decision_calls(self):
        client_ip = "198.51.100.99"
        server.request_times.pop(client_ip, None)
        self.assertTrue(all(server.allow_decision(client_ip) for _ in range(server.MAX_DECISIONS_PER_MINUTE)))
        self.assertFalse(server.allow_decision(client_ip))


if __name__ == "__main__":
    unittest.main()

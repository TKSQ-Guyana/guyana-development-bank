import json
import os
import unittest
from unittest.mock import patch

from gdb_bank.security import keycloak, errors

class TestSpecCompliance(unittest.TestCase):
	def test_approved_amount_is_not_read_only(self):
		"""
		The spec (§4.4) states approved_amount is 'Set by the Underwriter... 
		Enforced in the service, not the form.' 
		If it's read_only=1 in the JSON schema, the UI disables it for everyone.
		"""
		schema_path = os.path.join(
			os.path.dirname(__file__),
			"..",
			"gdb_bank",
			"doctype",
			"gdb_loan_application",
			"gdb_loan_application.json"
		)
		
		with open(schema_path, "r") as f:
			schema = json.load(f)
			
		found = False
		for field in schema.get("fields", []):
			if field.get("fieldname") == "approved_amount":
				found = True
				self.assertNotEqual(
					field.get("read_only"), 1,
					"approved_amount must not be read_only in the DocType schema. It should be enforced in the service."
				)
		self.assertTrue(found, "Field 'approved_amount' not found in schema.")

	@patch("jwt.decode")
	@patch("jwt.PyJWKClient")
	def test_verify_token_rejects_missing_azp(self, mock_jwk_client_class, mock_jwt_decode):
		"""
		The spec (§2.2) states `verify_token` must assert `claims['azp'] == KEYCLOAK_CLIENT_ID`.
		If `azp` is missing entirely, it must fail, not silently pass.
		"""
		# Mock the JWT decode to return a payload WITHOUT an azp claim
		mock_jwt_decode.return_value = {
			"sub": "123",
			"iss": keycloak.issuer(),
			"aud": keycloak.KEYCLOAK_CLIENT_ID,
			# "azp": is intentionally missing
		}
		
		# Ensure the signing key fetch doesn't fail
		mock_jwk_client = mock_jwk_client_class.return_value
		mock_jwk_client.get_signing_key_from_jwt.return_value.key = "fake_key"
		
		with self.assertRaises(errors.AuthenticationRequired) as context:
			keycloak.verify_token("fake_token")
			
		self.assertIn("could not be verified", str(context.exception))

	def test_demo_applications_are_seeded(self):
		"""
		The spec (§4.7) required that install.py seeds two or three applications 
		for the demo citizen across different stages.
		"""
		# Check if the make_demo_applications function exists in install.py
		try:
			from gdb_bank import install
			self.assertTrue(hasattr(install, "make_demo_applications"), "install.py must have a make_demo_applications function.")
		except ImportError:
			self.fail("Could not import install.py")

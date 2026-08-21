import unittest

from betfair_connector import ConnectorHandler


class ConnectorHandlerTests(unittest.TestCase):
    def test_request_logging_does_not_require_a_console(self):
        handler = object.__new__(ConnectorHandler)
        handler.path = "/index.html"
        handler.log_message('"GET /index.html HTTP/1.1" %s', "200")


if __name__ == "__main__":
    unittest.main()

import app from "./app";
const http = require("http");

const server = app.listen(4007, () => {
  console.log("listening on 4007");

  // Test health
  http.get("http://localhost:4007/health", (res: any) => {
    let d = "";
    res.on("data", (c: any) => (d += c));
    res.on("end", () => {
      console.log("health:", d);

      // Test login
      const req2 = http.request(
        {
          hostname: "localhost",
          port: 4007,
          path: "/api/auth/login",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (res2: any) => {
          let d2 = "";
          res2.on("data", (c: any) => (d2 += c));
          res2.on("end", () => {
            console.log("login:", d2);
            server.close();
            process.exit();
          });
        }
      );
      req2.write(
        JSON.stringify({ email: "admin@council.edu", password: "Admin@123" })
      );
      req2.end();
    });
  });
});

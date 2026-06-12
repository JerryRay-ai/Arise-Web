console.log("Website loaded");

const canvas = document.getElementById("navParticles");
const ctx = canvas.getContext("2d");

// Resize canvas to match navbar
function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Particle array
const particles = [];

// Increase for fewer dots, decrease for more dots
const spacing = 20;

// Create neatly arranged particles
for (let x = spacing; x < canvas.width; x += spacing) {
    for (let y = spacing; y < canvas.height; y += spacing) {
        particles.push({
            baseX: x,
            baseY: y,
            x: x,
            y: y,
            size: 1, // small dots
            color: Math.random() > 0.5 ? "#ff7a00" : "#22c55e"
        });
    }
}

let time = 0;

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach((particle, index) => {

        // Smooth synchronized movement
        particle.x = particle.baseX + Math.cos(time + index * 0.08) * 3;
        particle.y = particle.baseY + Math.sin(time + index * 0.08) * 3;

        ctx.beginPath();
        ctx.arc(
            particle.x,
            particle.y,
            particle.size,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = particle.color;
        ctx.fill();
    });

    time += 0.02;

    requestAnimationFrame(animate);
}

animate();
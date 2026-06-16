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

// Contact form handling (client-side validation and submission via fetch)
const contactForm = document.getElementById('contactForm');
if (contactForm) {
    const submitBtn = document.getElementById('submitBtn');
    const formStatus = document.getElementById('formStatus');

    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        formStatus.textContent = '';

        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const program = document.getElementById('program').value;

        if (!name || !email || !program) {
            formStatus.textContent = 'Please complete all required fields.';
            formStatus.style.color = '#8b1e1e';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            const action = contactForm.action;
            const formData = new FormData(contactForm);

            const res = await fetch(action, {
                method: 'POST',
                body: formData,
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (res.ok) {
                formStatus.textContent = 'Thanks — we received your registration. We will be in touch soon.';
                formStatus.style.color = '#0f5132';
                contactForm.reset();
            } else {
                const data = await res.json();
                formStatus.textContent = (data && data.error) ? data.error : 'Submission failed. Please try again later.';
                formStatus.style.color = '#8b1e1e';
            }
        } catch (err) {
            formStatus.textContent = 'Network error. Please check your connection and try again.';
            formStatus.style.color = '#8b1e1e';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Register / Send';
        }
    });
}
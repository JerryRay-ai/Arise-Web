console.log("Website loaded");

const navToggle = document.getElementById('navToggle');
const nav = document.querySelector('nav');

if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
        nav.classList.toggle('nav-open');
    });

    nav.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', () => {
            if (nav.classList.contains('nav-open')) {
                nav.classList.remove('nav-open');
            }
        });
    });
}

// Apply Now modal handling
const applyNowBtn = document.getElementById('applyNowBtn');
const applyModal = document.getElementById('applyModal');
const modalClose = document.getElementById('modalClose');

if (applyNowBtn && applyModal && modalClose) {
    applyNowBtn.addEventListener('click', () => {
        applyModal.classList.add('open');
    });

    modalClose.addEventListener('click', () => {
        applyModal.classList.remove('open');
    });

    applyModal.addEventListener('click', (event) => {
        if (event.target === applyModal) {
            applyModal.classList.remove('open');
        }
    });
}

const contactForm = document.getElementById('contactForm');
if (contactForm) {
    const submitBtn = document.getElementById('submitBtn');
    const formStatus = document.getElementById('formStatus');

    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        formStatus.textContent = '';

        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const message = document.getElementById('message').value.trim();

        if (!name || !email) {
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
                formStatus.textContent = 'Thanks — we received your message. We will be in touch soon.';
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

<!--
  ContactDialog – the "New/Edit Contact" modal of the Contacts page.

  Moved out of `views/Contacts.vue` so the page stays list/wiring-only. Owns the
  whole form state (name, photo, emails, phones, addresses, …), the photo picker
  and the modal a11y; emits the normalised contact data on save.

    props:
      open: boolean          dialog visibility
      editMode: boolean      "Edit Contact" vs "New Contact" title
      contact: Contact|null  the contact being edited (null = create)
    emits:
      close
      save [data: Omit<Contact, 'rawVcard' | 'href' | 'etag'>]
-->
<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div
        ref="contactPanelRef"
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-dialog-title"
      >
        <h2 id="contact-dialog-title" class="modal-title">
          {{ editMode ? $gettext('Edit contact') : $gettext('New contact') }}
        </h2>

        <form class="modal-form" @submit.prevent="onSubmit">
          <div class="form-top-row">
            <div class="form-top-fields">
              <oc-text-input v-model="contactForm.firstName" :label="$gettext('First name')" />
              <oc-text-input v-model="contactForm.lastName" :label="$gettext('Last name')" />
            </div>
            <div class="photo-avatar-wrap">
              <label class="photo-avatar-label">
                <img
                  v-if="safePhotoSrc(contactForm.photo)"
                  :src="safePhotoSrc(contactForm.photo)"
                  class="photo-avatar"
                  alt=""
                />
                <div v-else class="photo-avatar-placeholder">
                  <oc-icon name="camera" size="medium" />
                </div>
                <input
                  type="file"
                  accept="image/*"
                  class="file-input-hidden"
                  :aria-label="$gettext('Upload photo')"
                  @change="onPhotoSelect"
                />
              </label>
              <button
                v-if="contactForm.photo"
                type="button"
                class="photo-remove-link"
                @click="contactForm.photo = ''"
              >
                {{ $gettext('Remove') }}
              </button>
            </div>
          </div>

          <div class="multi-field-section">
            <label class="form-label">{{ $gettext('Email') }}</label>
            <div
              v-for="(email, idx) in contactForm.emails"
              :key="'email-' + idx"
              class="multi-field-row"
            >
              <select v-model="email.type" class="type-select">
                <option value="work">{{ $gettext('Work') }}</option>
                <option value="home">{{ $gettext('Home') }}</option>
                <option value="other">{{ $gettext('Other') }}</option>
              </select>
              <input
                v-model="email.value"
                type="email"
                class="form-input multi-field-input"
                :placeholder="$gettext('Email')"
              />
              <button
                v-if="contactForm.emails.length > 1"
                type="button"
                class="remove-field-btn"
                @click="contactForm.emails.splice(idx, 1)"
              >
                <oc-icon name="close" size="small" />
              </button>
            </div>
            <button
              type="button"
              class="add-field-btn"
              @click="contactForm.emails.push({ type: 'work', value: '' })"
            >
              + {{ $gettext('Add') }}
            </button>
          </div>

          <div class="multi-field-section">
            <label class="form-label">{{ $gettext('Phone') }}</label>
            <div
              v-for="(phone, idx) in contactForm.phones"
              :key="'phone-' + idx"
              class="multi-field-row"
            >
              <select v-model="phone.type" class="type-select">
                <option value="cell">{{ $gettext('Mobile') }}</option>
                <option value="home">{{ $gettext('Home') }}</option>
                <option value="work">{{ $gettext('Work') }}</option>
                <option value="fax">{{ $gettext('Fax') }}</option>
                <option value="other">{{ $gettext('Other') }}</option>
              </select>
              <input
                v-model="phone.value"
                type="tel"
                class="form-input multi-field-input"
                :placeholder="$gettext('Phone')"
              />
              <button
                v-if="contactForm.phones.length > 1"
                type="button"
                class="remove-field-btn"
                @click="contactForm.phones.splice(idx, 1)"
              >
                <oc-icon name="close" size="small" />
              </button>
            </div>
            <button
              type="button"
              class="add-field-btn"
              @click="contactForm.phones.push({ type: 'cell', value: '' })"
            >
              + {{ $gettext('Add') }}
            </button>
          </div>

          <div class="form-row">
            <oc-text-input v-model="contactForm.organization" :label="$gettext('Organization')" />
            <oc-text-input v-model="contactForm.title" :label="$gettext('Job title')" />
          </div>

          <fieldset class="form-fieldset">
            <legend class="form-legend">{{ $gettext('Address') }}</legend>
            <div class="address-list">
              <div
                v-for="(address, idx) in contactForm.addresses"
                :key="'address-' + idx"
                class="address-form-card"
              >
                <div class="address-form-header">
                  <select v-model="address.type" class="type-select address-type-select">
                    <option value="home">{{ $gettext('Home') }}</option>
                    <option value="work">{{ $gettext('Work') }}</option>
                    <option value="other">{{ $gettext('Other') }}</option>
                  </select>
                  <button
                    v-if="contactForm.addresses.length > 1"
                    type="button"
                    class="remove-field-btn"
                    :aria-label="$gettext('Remove')"
                    @click="contactForm.addresses.splice(idx, 1)"
                  >
                    <oc-icon name="close" size="small" />
                  </button>
                </div>
                <oc-text-input v-model="address.street" :label="$gettext('Street')" />
                <div class="form-row">
                  <oc-text-input v-model="address.postalCode" :label="$gettext('Postal code')" />
                  <oc-text-input v-model="address.city" :label="$gettext('City')" />
                </div>
                <div class="form-row">
                  <oc-text-input v-model="address.region" :label="$gettext('Region')" />
                  <oc-text-input v-model="address.country" :label="$gettext('Country')" />
                </div>
              </div>
            </div>
            <button
              type="button"
              class="add-field-btn"
              @click="contactForm.addresses.push(emptyAddress())"
            >
              + {{ $gettext('Add') }}
            </button>
          </fieldset>

          <div class="form-row">
            <oc-text-input
              v-model="contactForm.categories"
              :label="$gettext('Categories')"
              :placeholder="$gettext('e.g. Family, Work')"
            />
            <div class="form-group">
              <label class="form-label">{{ $gettext('Birthday') }}</label>
              <input v-model="contactForm.birthday" type="date" class="form-input" />
              <!-- vCard allows birthdays without a year (e.g. `--0415`). A date input
                   cannot display or produce that, so it is kept apart and saved back
                   untouched unless the user picks a full date. -->
              <p v-if="yearlessBirthday" class="form-hint">
                {{
                  $gettext('Birthday without year (%{date}) is kept. Pick a date to add a year.', {
                    date: yearlessBirthday
                  })
                }}
              </p>
            </div>
          </div>

          <oc-textarea v-model="contactForm.notes" :label="$gettext('Notes')" />

          <div class="modal-actions">
            <div class="spacer" />
            <oc-button appearance="outline" @click="emit('close')">{{
              $gettext('Cancel')
            }}</oc-button>
            <oc-button appearance="filled" submit="submit">{{ $gettext('Save') }}</oc-button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useMessages } from '@opencloud-eu/web-pkg'
import { safePhotoSrc } from '../../composables/useContactsService'
import { useModalA11y } from '../../composables/useModalA11y'
import type { Contact, ContactAddress } from '../../types'
import '../../styles/modal.css'

defineOptions({ name: 'ContactDialog' })

const props = defineProps<{
  open: boolean
  editMode: boolean
  contact: Contact | null
}>()

const emit = defineEmits<{
  close: []
  save: [data: Omit<Contact, 'rawVcard' | 'href' | 'etag'>]
}>()

const { $gettext } = useGettext()
const { showErrorMessage } = useMessages()

type ContactForm = {
  firstName: string
  lastName: string
  emails: Array<{ type: string; value: string }>
  phones: Array<{ type: string; value: string }>
  addresses: ContactAddress[]
  organization: string
  title: string
  notes: string
  categories: string
  birthday: string
  photo: string
}

function emptyAddress(type = 'home'): ContactAddress {
  return { type, street: '', city: '', region: '', postalCode: '', country: '' }
}

const contactForm = ref<ContactForm>({
  firstName: '',
  lastName: '',
  emails: [{ type: 'work', value: '' }],
  phones: [{ type: 'cell', value: '' }],
  addresses: [emptyAddress()],
  organization: '',
  title: '',
  notes: '',
  categories: '',
  birthday: '',
  photo: ''
})

const contactPanelRef = ref<HTMLElement | null>(null)

/**
 * The year-less part of the stored BDAY (`--04-15`). `<input type="date">`
 * cannot show such a value, so it is parked here and written back on save unless the
 * user picks a full date in the picker.
 */
const yearlessBirthday = ref('')

useModalA11y(
  contactPanelRef,
  computed(() => props.open),
  { onClose: () => emit('close') }
)

function resetForm() {
  yearlessBirthday.value = ''
  contactForm.value = {
    firstName: '',
    lastName: '',
    emails: [{ type: 'work', value: '' }],
    phones: [{ type: 'cell', value: '' }],
    addresses: [emptyAddress()],
    organization: '',
    title: '',
    notes: '',
    categories: '',
    birthday: '',
    photo: ''
  }
}

/** Fill the form when the dialog opens (create: empty; edit: from the contact). */
watch(
  () => [props.open, props.contact] as const,
  () => {
    if (!props.open) return
    const contact = props.contact
    if (props.editMode && contact) {
      yearlessBirthday.value = contact.birthday?.startsWith('--') ? contact.birthday : ''
      contactForm.value = {
        firstName: contact.firstName,
        lastName: contact.lastName,
        emails: contact.emails.length
          ? contact.emails.map((e) => ({ ...e }))
          : [{ type: 'work', value: '' }],
        phones: contact.phones.length
          ? contact.phones.map((p) => ({ ...p }))
          : [{ type: 'cell', value: '' }],
        addresses: contact.addresses.length
          ? contact.addresses.map((a) => ({ ...emptyAddress(a.type), ...a }))
          : [emptyAddress()],
        organization: contact.organization,
        title: contact.title,
        notes: contact.notes,
        categories: contact.categories?.join(', ') || '',
        birthday: contact.birthday?.startsWith('--') ? '' : contact.birthday || '',
        photo: contact.photo || ''
      }
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

function onSubmit() {
  const f = contactForm.value
  const firstEmail = f.emails.find((e) => e.value)?.value || ''
  const displayName = [f.firstName, f.lastName].filter(Boolean).join(' ') || firstEmail || 'Unnamed'
  const addresses = f.addresses
    .map((a) => ({
      type: a.type || 'home',
      street: a.street.trim(),
      city: a.city.trim(),
      region: a.region.trim(),
      postalCode: a.postalCode.trim(),
      country: a.country.trim()
    }))
    .filter((a) => a.street || a.city || a.region || a.postalCode || a.country)

  emit('save', {
    id: props.contact?.id || crypto.randomUUID(),
    displayName,
    firstName: f.firstName,
    lastName: f.lastName,
    emails: f.emails.filter((e) => e.value.trim()),
    phones: f.phones.filter((p) => p.value.trim()),
    addresses,
    organization: f.organization,
    title: f.title,
    notes: f.notes,
    categories: f.categories
      ? f.categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : undefined,
    birthday: f.birthday || yearlessBirthday.value || undefined,
    photo: f.photo || undefined
  })
}

function onPhotoSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const maxSize = 1024 * 1024
  if (!allowedTypes.includes(file.type) || file.size > maxSize) {
    showErrorMessage({ title: $gettext('Photo must be JPEG, PNG, GIF, or WebP and under 1 MB') })
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    contactForm.value.photo = reader.result as string
  }
  reader.readAsDataURL(file)
}
</script>

<style scoped>
/* Explains that a year-less birthday (not displayable by <input type="date">) is kept. */
.form-hint {
  margin: 2px 4px 0;
  font-size: 0.75rem;
  color: var(--oc-role-on-surface-variant, #40484c);
}

/* Overlay/panel/form primitives live in `src/styles/modal.css`; this dialog
   keeps its form layout and the sticky action bar. */
.modal-overlay {
  z-index: 9999;
}

.modal-title {
  font-size: 1.125rem;
  margin-bottom: 14px;
}

.address-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.address-form-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--oc-role-surface-container, #eceef0);
  border-radius: 8px;
  background: var(--oc-role-surface-container-lowest, #ffffff);
}

.address-form-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.address-type-select {
  width: 110px;
}

.form-fieldset {
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 8px;
  padding: 12px;
}
.form-legend {
  font-size: 0.8125rem;
  font-weight: 500;
  padding: 0 4px;
  color: var(--oc-role-on-surface-variant, #40484c);
}

.form-label {
  font-size: 0.8125rem;
}
.form-input {
  font-size: 0.875rem;
}

.form-top-row {
  display: flex;
  align-items: flex-start;
  gap: 24px;
}
.form-top-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.photo-avatar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-top: 28px;
  margin-left: 6px;
}
.photo-avatar-label {
  cursor: pointer;
  display: block;
}
.photo-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--oc-role-outline-variant, #bfc8cc);
  transition: border-color 0.15s;
}
.photo-avatar-label:hover .photo-avatar {
  border-color: var(--oc-role-secondary, #20434f);
}
.photo-avatar-placeholder {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--oc-role-surface-container, #eceef0);
  border: 2px dashed var(--oc-role-outline-variant, #bfc8cc);
  color: var(--oc-role-on-surface-variant, #40484c);
  transition:
    border-color 0.15s,
    background 0.15s;
}
.photo-avatar-label:hover .photo-avatar-placeholder {
  border-color: var(--oc-role-secondary, #20434f);
  background: var(--oc-role-primary-container, #b7eaff);
}
.photo-remove-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.6875rem;
  color: var(--oc-role-error, #ba1a1a);
  text-decoration: underline;
}
.file-input-hidden {
  display: none;
}

.multi-field-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.multi-field-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.multi-field-input {
  flex: 1;
}
.type-select {
  width: 90px;
  border: 1px solid var(--oc-role-outline-variant, #bfc8cc);
  border-radius: 4px;
  padding: 8px 4px;
  font-size: 0.8125rem;
  background: var(--oc-role-surface, #fbfcfe);
  color: var(--oc-role-on-surface, #191c1d);
  height: 36px;
  box-sizing: border-box;
}
.type-select:focus {
  outline: none;
  border-color: var(--oc-role-secondary, #20434f);
}
.remove-field-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--oc-role-on-surface-variant, #40484c);
  border-radius: 50%;
}
.remove-field-btn:hover {
  color: var(--oc-role-error, #ba1a1a);
}
.add-field-btn {
  align-self: flex-start;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8125rem;
  color: var(--oc-role-secondary, #20434f);
  padding: 2px 0;
}
.add-field-btn:hover {
  text-decoration: underline;
}

/* Sticky full-bleed footer (Contacts/Tools dialog pattern). */
.modal-actions {
  padding: 12px 24px;
  margin: 12px -24px -24px;
  background: var(--oc-role-surface-container-lowest, #ffffff);
  position: sticky;
  bottom: -24px;
  border-radius: 0 0 16px 16px;
}

@media (max-width: 640px) {
  /* Reduce gap in form-top-row so name fields + avatar don't overflow */
  .form-top-row {
    gap: 12px;
  }
}
</style>

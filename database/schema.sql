CREATE TABLE IF NOT EXISTS users (
  user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','organizer','member') NOT NULL DEFAULT 'member',
  department VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  event_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  venue VARCHAR(150) NOT NULL,
  coordinator_id INT UNSIGNED NULL,
  capacity INT UNSIGNED NOT NULL DEFAULT 100,
  registration_deadline DATE NULL,
  status ENUM('planned','registration_open','ongoing','completed','cancelled') NOT NULL DEFAULT 'planned',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_coordinator FOREIGN KEY (coordinator_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_events_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_events_date (event_date),
  INDEX idx_events_category (category),
  INDEX idx_events_status (status),
  INDEX idx_events_venue_date (venue, event_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS participants (
  participant_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  department VARCHAR(100) NOT NULL,
  year TINYINT UNSIGNED NOT NULL,
  phone VARCHAR(20) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS registrations (
  registration_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  participant_id INT UNSIGNED NOT NULL,
  registration_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('registered','waitlisted','cancelled') NOT NULL DEFAULT 'registered',
  CONSTRAINT fk_reg_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_reg_participant FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  UNIQUE KEY uq_reg_event_participant (event_id, participant_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance (
  attendance_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  participant_id INT UNSIGNED NOT NULL,
  present BOOLEAN NOT NULL DEFAULT FALSE,
  marked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_att_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_att_participant FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  UNIQUE KEY uq_att_event_participant (event_id, participant_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS organizers (
  organizer_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  responsibility VARCHAR(200) NOT NULL,
  CONSTRAINT fk_org_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_org_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY uq_org_event_user (event_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS certificates (
  certificate_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  certificate_code VARCHAR(40) NOT NULL UNIQUE,
  event_id INT UNSIGNED NOT NULL,
  participant_id INT UNSIGNED NOT NULL,
  s3_key VARCHAR(500) NULL,
  status ENUM('pending','issued') NOT NULL DEFAULT 'pending',
  issued_date DATE NULL,
  CONSTRAINT fk_cert_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_cert_participant FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
  UNIQUE KEY uq_cert_event_participant (event_id, participant_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_files (
  file_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  s3_key VARCHAR(500) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  file_type ENUM('photo','report','poster','document') NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_file_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_file_user FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_files_event (event_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outcomes (
  outcome_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL UNIQUE,
  participants_count INT UNSIGNED NOT NULL DEFAULT 0,
  feedback_score DECIMAL(3,2) NULL,
  winners TEXT NULL,
  description TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_out_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB;
